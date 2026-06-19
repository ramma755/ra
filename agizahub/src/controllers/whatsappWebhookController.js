const bcrypt = require("bcrypt");
const { query, transaction } = require("../config/db");
const env = require("../config/env");
const { parseMarketplaceMessage } = require("../services/aiParserService");
const { initiateStkPush, normalizeMsisdn } = require("../services/darajaService");
const logger = require("../services/logger");

const twimlResponse = (message) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;

const resolveProduct = async (client, parsedProduct) => {
  if (!parsedProduct) return null;

  const direct = await client.query(
    `
      SELECT p.*
      FROM products p
      WHERE LOWER(p.name) = LOWER($1)
      LIMIT 1
    `,
    [parsedProduct]
  );
  if (direct.rowCount > 0) return direct.rows[0];

  const slang = await client.query(
    `
      SELECT p.*
      FROM product_slang s
      JOIN products p ON p.id = s.product_id
      WHERE LOWER(s.phrase) = LOWER($1)
      LIMIT 1
    `,
    [parsedProduct]
  );
  return slang.rows[0] || null;
};

const resolveVendorInventory = async (client, productId, preferredVendor) => {
  if (!productId) return null;
  return client.query(
    `
      SELECT
        vi.*,
        v.name AS vendor_name,
        v.wallet_type,
        v.mpesa_identifier,
        v.account_reference
      FROM vendor_inventory vi
      JOIN vendors v ON v.id = vi.vendor_id
      WHERE vi.product_id = $1
        AND vi.is_active = TRUE
        AND (
          $2::text IS NULL
          OR LOWER(v.name) LIKE CONCAT('%', LOWER($2), '%')
        )
      ORDER BY vi.price_kes ASC
      LIMIT 1
    `,
    [productId, preferredVendor || null]
  );
};

const resolveTransporter = async (client) =>
  client.query(
    `
      SELECT id, name, phone
      FROM transporters
      WHERE is_active = TRUE
      ORDER BY created_at ASC
      LIMIT 1
    `
  );

const handleIncomingWhatsapp = async (req, res, next) => {
  try {
    const rawMessage = (req.body.Body || "").trim();
    const from = req.body.From || "";
    const senderPhone = normalizeMsisdn(req.body.WaId || from.replace("whatsapp:", ""));
    const senderName = req.body.ProfileName || "Buyer";

    if (!rawMessage) {
      return res
        .type("text/xml")
        .send(twimlResponse("Tuma order yako kwa ujumbe mmoja. Mfano: 20kg nyanya to Gikomba."));
    }

    const parsed = await parseMarketplaceMessage(rawMessage);
    if (parsed.intent !== "order_request") {
      return res
        .type("text/xml")
        .send(
          twimlResponse(
            "Sijaelewa order. Tuma kama: 20kg nyanya to Westlands kesho asubuhi."
          )
        );
    }

    const payload = await transaction(async (client) => {
      const product = await resolveProduct(client, parsed.product);
      if (!product) {
        throw new Error("Product not found. Add it in products/product_slang first.");
      }

      const inventoryResult = await resolveVendorInventory(
        client,
        product.id,
        parsed.preferredVendor
      );
      if (inventoryResult.rowCount === 0) {
        throw new Error("No active vendor inventory found for this product.");
      }
      const inventory = inventoryResult.rows[0];

      const transporterResult = await resolveTransporter(client);
      const transporter = transporterResult.rows[0] || null;

      const quantity = Number(parsed.quantity || 1);
      const deliveryFee = Number(env.businessRules.defaultDeliveryFeeKes);
      const subtotal = quantity * Number(inventory.price_kes);
      const platformFee = Number(
        ((subtotal * env.businessRules.platformCommissionPercent) / 100).toFixed(2)
      );
      const vendorAmount = Number((subtotal - platformFee).toFixed(2));
      const driverAmount = deliveryFee;
      const totalAmount = Number((subtotal + deliveryFee).toFixed(2));
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const otpHash = await bcrypt.hash(otp, 10);

      const orderResult = await client.query(
        `
          INSERT INTO orders (
            source_channel,
            buyer_phone,
            buyer_name,
            raw_message,
            parsed_payload,
            product_id,
            quantity,
            delivery_location,
            vendor_id,
            transporter_id,
            total_amount_kes,
            platform_fee_kes,
            vendor_amount_kes,
            driver_amount_kes,
            delivery_fee_kes,
            otp_code_hash,
            otp_expires_at,
            payment_status,
            settlement_status,
            distribution_status
          )
          VALUES (
            'WHATSAPP',
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW() + INTERVAL '12 hours',
            'PENDING_PAYMENT',
            'NOT_STARTED',
            'NOT_STARTED'
          )
          RETURNING *
        `,
        [
          senderPhone,
          senderName,
          rawMessage,
          JSON.stringify(parsed),
          product.id,
          quantity,
          parsed.deliveryLocation || "To be confirmed",
          inventory.vendor_id,
          transporter ? transporter.id : null,
          totalAmount,
          platformFee,
          vendorAmount,
          driverAmount,
          deliveryFee,
          otpHash,
        ]
      );

      return {
        order: orderResult.rows[0],
        inventory,
        transporter,
        otp,
      };
    });

    const stkResponse = await initiateStkPush({
      phoneNumber: senderPhone,
      amount: payload.order.total_amount_kes,
      accountReference: `ORD-${payload.order.id.slice(0, 8)}`,
      transactionDesc: `AgizaHub ${payload.inventory.vendor_name}`,
    });

    await query(
      `
        INSERT INTO mpesa_stk_transactions (
          order_id,
          checkout_request_id,
          merchant_request_id,
          amount_kes,
          msisdn,
          status,
          raw_response
        )
        VALUES ($1,$2,$3,$4,$5,'REQUESTED',$6)
      `,
      [
        payload.order.id,
        stkResponse.CheckoutRequestID,
        stkResponse.MerchantRequestID || null,
        payload.order.total_amount_kes,
        senderPhone,
        JSON.stringify(stkResponse),
      ]
    );

    await query(
      `
        UPDATE orders
        SET mpesa_checkout_request_id = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [payload.order.id, stkResponse.CheckoutRequestID]
    );

    logger.info("Order created from WhatsApp message", {
      orderId: payload.order.id,
      buyer: senderPhone,
    });

    return res.type("text/xml").send(
      twimlResponse(
        [
          `Order ${payload.order.id.slice(0, 8)} imepokelewa.`,
          `Lipa M-Pesa prompt ya KES ${payload.order.total_amount_kes}.`,
          `OTP ya delivery: ${payload.otp} (share on delivery only).`,
        ].join(" ")
      )
    );
  } catch (error) {
    logger.error("WhatsApp inbound failed", { error: error.message });
    return next(error);
  }
};

module.exports = {
  handleIncomingWhatsapp,
};
