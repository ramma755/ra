const bcrypt = require("bcrypt");
const { query, transaction } = require("../config/db");
const env = require("../config/env");
const { parseMarketplaceMessage } = require("../services/aiParserService");
const { initiateStkPush, normalizeMsisdn } = require("../services/darajaService");
const {
  normalizeCommunicationPhone,
  toPayoutPhone,
  roleFromChoice,
  paymentModeFromChoice,
  formatPublicMaskedId,
  ensureUserRecord,
} = require("../services/platformUserService");
const {
  verifyOtpAndQueueRelease,
  releaseOrderByAdmin,
  holdOrderByAdmin,
  requestOrderRefund,
  approveRefundByAdmin,
  rejectRefundByAdmin,
} = require("../services/settlementService");
const {
  haversineDistanceKm,
  computeTransportBreakdown,
} = require("../services/logisticsPricingService");
const logger = require("../services/logger");

const twimlResponse = (message) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;

const onboardingMenu = () =>
  [
    "Jambo! Welcome to AgizaHub. I see you are new here.",
    "How would you like to use our platform today?",
    "",
    "Reply with:",
    "1 - Register as a Buyer",
    "2 - Register as a Supplier / Wholesaler",
    "3 - Register as a Transporter (Short distance / Motorbike)",
    "4 - Register as a Transporter (Long distance / Truck)",
  ].join("\n");

const paymentModeMenu = () =>
  [
    "How should AgizaHub process payments or refunds to your account?",
    "Reply with:",
    "1 - Send Money (M-Pesa to your phone)",
    "2 - Buy Goods Till Number",
    "3 - Business Paybill",
  ].join("\n");

const parseCoordinates = (input) => {
  const parts = String(input || "").split(",");
  if (parts.length < 2) return null;
  const latitude = Number(parts[0].trim());
  const longitude = Number(parts[1].trim());
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
  };
};

const normalizeOrderIdFromText = (text) => (text || "").trim();

const parseCatalogLine = (rawMessage) => {
  const chunks = rawMessage.split(",");
  if (chunks.length < 2) return null;
  const commodity = chunks[0].trim();
  const price = Number(chunks[1].replace(/[^\d.]/g, "").trim());
  if (!commodity || Number.isNaN(price) || price <= 0) return null;
  return { commodity, price };
};

const resolveUserByMaskedId = async (client, maskedId) => {
  const result = await client.query(
    `SELECT * FROM platform_users WHERE masked_id = $1 LIMIT 1`,
    [maskedId]
  );
  return result.rows[0] || null;
};

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

const resolveVendorInventory = async (client, productId, preferredVendor) =>
  client.query(
    `
      SELECT
        vi.*,
        v.name AS vendor_name
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

const listCatalogOffersMessage = async () => {
  const result = await query(
    `
      SELECT
        c.commodity_name,
        c.price_per_unit,
        c.unit_measure,
        c.location_label,
        u.masked_id,
        u.company_name
      FROM catalog_items c
      JOIN platform_users u ON u.masked_id = c.seller_masked_id
      WHERE c.is_active = TRUE
        AND u.user_type = 'SUPPLIER'
      ORDER BY c.price_per_unit ASC, c.created_at ASC
      LIMIT 15
    `
  );

  if (result.rowCount === 0) {
    return "Hakuna offers kwa sasa. Suppliers wanapakia stock hivi karibuni.";
  }

  const lines = ["Available Offers Today:"];
  for (const item of result.rows) {
    lines.push(
      "",
      `${item.commodity_name}`,
      `Seller: ${item.company_name || `Supplier #${item.masked_id}`} (ID: #${item.masked_id})`,
      `Price: KSh ${Number(item.price_per_unit).toLocaleString()} per ${item.unit_measure}`,
      `Location: ${item.location_label}`,
      `To purchase: Buy ${item.masked_id} 10`
    );
  }
  return lines.join("\n");
};

const isAdminPhone = (communicationPhone, senderPhone) => {
  const configured = (env.admin.whatsappPhone || "").trim();
  if (!configured) return false;
  if (configured === communicationPhone) return true;
  const configuredDigits = normalizeMsisdn(configured.replace("whatsapp:+", ""));
  return configuredDigits && configuredDigits === senderPhone;
};

const handleAdminCommand = async (rawMessage, senderPhone) => {
  const releaseMatch = rawMessage.match(/^release\s+([a-zA-Z0-9-]+)/i);
  if (releaseMatch) {
    const orderId = normalizeOrderIdFromText(releaseMatch[1]);
    await releaseOrderByAdmin({ orderId, actorPhone: senderPhone });
    return `Order #${orderId} released. Payouts submitted.`;
  }

  const holdMatch = rawMessage.match(/^hold\s+([a-zA-Z0-9-]+)(?:\s+(.+))?/i);
  if (holdMatch) {
    const orderId = normalizeOrderIdFromText(holdMatch[1]);
    await holdOrderByAdmin({
      orderId,
      actorPhone: senderPhone,
      note: holdMatch[2] || null,
    });
    return `Order #${orderId} is now ON_HOLD for investigation.`;
  }

  const approveMatch = rawMessage.match(/^approve\s+([a-zA-Z0-9-]+)/i);
  if (approveMatch) {
    const orderId = normalizeOrderIdFromText(approveMatch[1]);
    await approveRefundByAdmin({ orderId, actorPhone: senderPhone });
    return `Refund approved for order #${orderId}. Buyer refund submitted.`;
  }

  const rejectMatch = rawMessage.match(/^reject\s+([a-zA-Z0-9-]+)/i);
  if (rejectMatch) {
    const orderId = normalizeOrderIdFromText(rejectMatch[1]);
    await rejectRefundByAdmin({ orderId, actorPhone: senderPhone });
    await releaseOrderByAdmin({ orderId, actorPhone: senderPhone });
    return `Refund rejected for #${orderId}. Standard payouts released.`;
  }

  return null;
};

const formatCheckoutSummary = ({
  quantity,
  commodityName,
  unitMeasure,
  unitPrice,
  itemSubtotal,
  supplierHubLabel,
  buyerDestinationLabel,
  transport,
  totalAmount,
}) =>
  [
    "AGIZAHUB ORDER SUMMARY",
    "--------------------------",
    `Items: ${quantity} ${unitMeasure} of ${commodityName} @ KSh ${Number(
      unitPrice
    ).toLocaleString()} = KSh ${Number(itemSubtotal).toLocaleString()}`,
    `Supplier Hub: ${supplierHubLabel}`,
    `Delivery Destination: ${buyerDestinationLabel}`,
    `Transport Fee (${transport.distanceKm} KM): KSh ${Number(
      transport.totalTransportFeeKes
    ).toLocaleString()}`,
    "--------------------------",
    `TOTAL AMOUNT TO PAY: KSh ${Number(totalAmount).toLocaleString()}`,
    "Reply 1 to confirm. M-Pesa prompt will appear instantly.",
  ].join("\n");

const createOrderFromCatalogRequest = async ({
  buyer,
  senderPhone,
  rawMessage,
  sellerMaskedId,
  quantity,
}) =>
  transaction(async (client) => {
    const seller = await resolveUserByMaskedId(client, sellerMaskedId);
    if (!seller || seller.user_type !== "SUPPLIER") {
      throw new Error("Supplier ID not found");
    }

    if (
      seller.hub_latitude == null ||
      seller.hub_longitude == null ||
      buyer.delivery_latitude == null ||
      buyer.delivery_longitude == null
    ) {
      throw new Error(
        "Missing coordinates. Supplier and buyer must complete location onboarding."
      );
    }

    const itemResult = await client.query(
      `
        SELECT *
        FROM catalog_items
        WHERE seller_masked_id = $1
          AND is_active = TRUE
        ORDER BY price_per_unit ASC
        LIMIT 1
      `,
      [sellerMaskedId]
    );
    if (itemResult.rowCount === 0) {
      throw new Error("Supplier has no active catalog item");
    }
    const catalogItem = itemResult.rows[0];

    const transporterResult = await client.query(
      `
        SELECT *
        FROM platform_users
        WHERE user_type IN ('TRANSPORTER_BIKE', 'TRANSPORTER_TRUCK')
          AND current_step = 'COMPLETED'
        ORDER BY created_at ASC
        LIMIT 1
      `
    );
    const transporter = transporterResult.rows[0] || null;

    const itemSubtotal = Number(quantity) * Number(catalogItem.price_per_unit);
    const matchingPercent = Number(env.businessRules.matchingCommissionPercent);
    const matchingCommission = Number(
      ((itemSubtotal * matchingPercent) / 100).toFixed(2)
    );

    const distanceKm =
      haversineDistanceKm({
        fromLat: seller.hub_latitude,
        fromLng: seller.hub_longitude,
        toLat: buyer.delivery_latitude,
        toLng: buyer.delivery_longitude,
      }) || Number(env.businessRules.transportBaseDistanceKm);

    const transport = computeTransportBreakdown({ distanceKm });
    const vendorAmount = Number((itemSubtotal - matchingCommission).toFixed(2));
    const driverAmount = Number(transport.rawTransportFeeKes);
    const platformFee = Number(
      (matchingCommission + transport.logisticsPremiumKes).toFixed(2)
    );
    const totalAmount = Number(
      (itemSubtotal + transport.totalTransportFeeKes).toFixed(2)
    );
    const otp = String(Math.floor(1000 + Math.random() * 9000));
    const otpHash = await bcrypt.hash(otp, 10);

    const orderInsert = await client.query(
      `
        INSERT INTO orders (
          source_channel,
          buyer_phone,
          buyer_name,
          raw_message,
          parsed_payload,
          quantity,
          delivery_location,
          total_amount_kes,
          platform_fee_kes,
          vendor_amount_kes,
          driver_amount_kes,
          delivery_fee_kes,
          otp_code_hash,
          otp_expires_at,
          payment_status,
          settlement_status,
          distribution_status,
          buyer_masked_id,
          supplier_masked_id,
          transporter_masked_id,
          commission_percent,
          logistics_premium_percent,
          matching_commission_kes,
          logistics_premium_kes,
          distance_km,
          base_transport_fee_kes,
          extra_distance_km,
          extra_distance_fee_kes,
          raw_transport_fee_kes,
          transport_rate_payload
        )
        VALUES (
          'WHATSAPP',
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW() + INTERVAL '12 hours',
          'PENDING_PAYMENT',
          'NOT_STARTED',
          'NOT_STARTED',
          $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
        )
        RETURNING *
      `,
      [
        senderPhone,
        buyer.company_name || "Buyer",
        rawMessage,
        JSON.stringify({
          source: "catalog_buy_command",
          sellerMaskedId,
          quantity,
          commodity: catalogItem.commodity_name,
          pricePerUnit: catalogItem.price_per_unit,
        }),
        quantity,
        catalogItem.location_label,
        totalAmount,
        platformFee,
        vendorAmount,
        driverAmount,
        transport.totalTransportFeeKes,
        otpHash,
        buyer.masked_id,
        seller.masked_id,
        transporter?.masked_id || null,
        matchingPercent,
        transport.logisticsPremiumPercent,
        matchingCommission,
        transport.logisticsPremiumKes,
        transport.distanceKm,
        transport.baseFeeKes,
        transport.extraDistanceKm,
        transport.extraDistanceFeeKes,
        transport.rawTransportFeeKes,
        JSON.stringify(transport),
      ]
    );

    await client.query(
      `
        UPDATE platform_users
        SET current_step = 'AWAITING_ORDER_CONFIRM',
            pending_order_id = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [buyer.id, orderInsert.rows[0].id]
    );

    return {
      order: orderInsert.rows[0],
      seller,
      buyer,
      catalogItem,
      transport,
      itemSubtotal,
      otp,
    };
  });

const confirmPendingOrderPayment = async ({ user, senderPhone }) =>
  transaction(async (client) => {
    if (!user.pending_order_id) {
      throw new Error("No pending order awaiting confirmation");
    }

    const orderResult = await client.query(
      `
        SELECT *
        FROM orders
        WHERE id = $1
          AND buyer_masked_id = $2
        FOR UPDATE
      `,
      [user.pending_order_id, user.masked_id]
    );
    if (orderResult.rowCount === 0) {
      throw new Error("Pending order not found");
    }
    const order = orderResult.rows[0];

    const existingTxn = await client.query(
      `
        SELECT 1
        FROM mpesa_stk_transactions
        WHERE order_id = $1
        LIMIT 1
      `,
      [order.id]
    );
    if (existingTxn.rowCount > 0) {
      await client.query(
        `
          UPDATE platform_users
          SET current_step = 'COMPLETED',
              pending_order_id = NULL,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return {
        orderId: order.id,
        totalAmountKes: Number(order.total_amount_kes),
        alreadyInitiated: true,
      };
    }

    const stkResponse = await initiateStkPush({
      phoneNumber: senderPhone,
      amount: order.total_amount_kes,
      accountReference: `ORD-${order.id.slice(0, 8)}`,
      transactionDesc: `AgizaHub Seller #${order.supplier_masked_id || "N/A"}`,
    });

    await client.query(
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
        order.id,
        stkResponse.CheckoutRequestID,
        stkResponse.MerchantRequestID || null,
        order.total_amount_kes,
        senderPhone,
        JSON.stringify(stkResponse),
      ]
    );

    await client.query(
      `
        UPDATE orders
        SET mpesa_checkout_request_id = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [order.id, stkResponse.CheckoutRequestID]
    );

    await client.query(
      `
        UPDATE platform_users
        SET current_step = 'COMPLETED',
            pending_order_id = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [user.id]
    );

    return {
      orderId: order.id,
      totalAmountKes: Number(order.total_amount_kes),
      alreadyInitiated: false,
    };
  });

const processLegacyAiOrder = async ({ rawMessage, senderPhone, senderName }) => {
  const parsed = await parseMarketplaceMessage(rawMessage);
  if (parsed.intent !== "order_request") {
    return {
      errorMessage:
        "Sijaelewa order. Tumia Buy [Seller ID] [Qty] ama andika 'buy' kuona offers.",
    };
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
    const itemSubtotal = quantity * Number(inventory.price_kes);
    const matchingCommission = Number(
      ((itemSubtotal * env.businessRules.matchingCommissionPercent) / 100).toFixed(2)
    );
    const transport = computeTransportBreakdown({
      distanceKm: env.businessRules.transportBaseDistanceKm,
    });
    const platformFee = Number(
      (matchingCommission + transport.logisticsPremiumKes).toFixed(2)
    );
    const vendorAmount = Number((itemSubtotal - matchingCommission).toFixed(2));
    const driverAmount = Number(transport.rawTransportFeeKes);
    const totalAmount = Number(
      (itemSubtotal + transport.totalTransportFeeKes).toFixed(2)
    );
    const otp = String(Math.floor(1000 + Math.random() * 9000));
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
          distribution_status,
          commission_percent,
          logistics_premium_percent,
          matching_commission_kes,
          logistics_premium_kes,
          distance_km,
          base_transport_fee_kes,
          extra_distance_km,
          extra_distance_fee_kes,
          raw_transport_fee_kes,
          transport_rate_payload
        )
        VALUES (
          'WHATSAPP',
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW() + INTERVAL '12 hours',
          'PENDING_PAYMENT',
          'NOT_STARTED',
          'NOT_STARTED',
          $16,$17,$18,$19,$20,$21,$22,$23,$24
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
        transport.totalTransportFeeKes,
        otpHash,
        env.businessRules.matchingCommissionPercent,
        env.businessRules.logisticsPremiumPercent,
        matchingCommission,
        transport.logisticsPremiumKes,
        transport.distanceKm,
        transport.baseFeeKes,
        transport.extraDistanceKm,
        transport.extraDistanceFeeKes,
        transport.rawTransportFeeKes,
        JSON.stringify(transport),
      ]
    );
    return { order: orderResult.rows[0], inventory, otp };
  });

  return { payload };
};

const nextStepAfterPaymentSelection = (userType) => {
  if (userType === "BUYER") return "AWAITING_BUYER_LOCATION";
  if (userType === "SUPPLIER") return "AWAITING_SUPPLIER_HUB";
  return "COMPLETED";
};

const processOnboardingStep = async ({ user, rawMessage, senderPhone }) => {
  const trimmed = rawMessage.trim();

  return transaction(async (client) => {
    if (!user.user_type) {
      const selectedRole = roleFromChoice(trimmed);
      if (!selectedRole) return onboardingMenu();

      if (selectedRole === "BUYER") {
        await client.query(
          `
            UPDATE platform_users
            SET user_type = $2,
                current_step = 'AWAITING_PAYMENT_MODE',
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id, selectedRole]
        );
        return paymentModeMenu();
      }

      await client.query(
        `
          UPDATE platform_users
          SET user_type = $2,
              current_step = 'AWAITING_COMPANY_NAME',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, selectedRole]
      );
      return "Great. Reply with your official business/company or transporter name.";
    }

    if (user.current_step === "AWAITING_COMPANY_NAME") {
      await client.query(
        `
          UPDATE platform_users
          SET company_name = $2,
              current_step = 'AWAITING_PAYMENT_MODE',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, trimmed.slice(0, 100)]
      );
      return paymentModeMenu();
    }

    if (user.current_step === "AWAITING_PAYMENT_MODE") {
      const paymentMode = paymentModeFromChoice(trimmed);
      if (!paymentMode) return `Invalid option.\n\n${paymentModeMenu()}`;

      if (paymentMode === "SEND_MONEY") {
        const nextStep = nextStepAfterPaymentSelection(user.user_type);
        await client.query(
          `
            UPDATE platform_users
            SET payment_mode = 'SEND_MONEY',
                payout_phone = $2,
                current_step = $3,
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id, senderPhone, nextStep]
        );
        if (nextStep === "AWAITING_BUYER_LOCATION") {
          return "Send your delivery location coordinates as: latitude,longitude (example: -1.286389,36.817223)";
        }
        if (nextStep === "AWAITING_SUPPLIER_HUB") {
          return "Send your supplier hub coordinates as: latitude,longitude (example: -0.727322,36.429387)";
        }
        return `Registration complete! Your secure account ID is ${formatPublicMaskedId(
          user.user_type,
          user.masked_id
        )}.`;
      }

      if (paymentMode === "TILL") {
        await client.query(
          `
            UPDATE platform_users
            SET payment_mode = 'TILL',
                current_step = 'AWAITING_TILL_NUMBER',
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id]
        );
        return "Please reply with your 5-7 digit Till Number.";
      }

      await client.query(
        `
          UPDATE platform_users
          SET payment_mode = 'PAYBILL',
              current_step = 'AWAITING_PAYBILL_DETAILS',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return "Please reply with: Business Number, Account Number (e.g., 222222, ACC123)";
    }

    if (user.current_step === "AWAITING_TILL_NUMBER") {
      const till = trimmed.replace(/[^\d]/g, "");
      if (!/^\d{5,7}$/.test(till)) {
        return "Invalid Till Number. Send only 5-7 digits.";
      }
      const nextStep = nextStepAfterPaymentSelection(user.user_type);
      await client.query(
        `
          UPDATE platform_users
          SET business_number = $2,
              current_step = $3,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, till, nextStep]
      );
      if (nextStep === "AWAITING_BUYER_LOCATION") {
        return "Now send buyer delivery coordinates: latitude,longitude";
      }
      if (nextStep === "AWAITING_SUPPLIER_HUB") {
        return "Now send supplier hub coordinates: latitude,longitude";
      }
      return `Registration complete! Your secure account ID is ${formatPublicMaskedId(
        user.user_type,
        user.masked_id
      )}.`;
    }

    if (user.current_step === "AWAITING_PAYBILL_DETAILS") {
      const parts = trimmed.split(",");
      if (parts.length < 2) return "Use format: 222222, ACC123";
      const businessNumber = parts[0].replace(/[^\d]/g, "");
      const accountNumber = parts.slice(1).join(",").trim().slice(0, 50);
      if (!businessNumber || !accountNumber) {
        return "Both Business Number and Account Number are required.";
      }
      const nextStep = nextStepAfterPaymentSelection(user.user_type);
      await client.query(
        `
          UPDATE platform_users
          SET business_number = $2,
              account_number = $3,
              current_step = $4,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, businessNumber, accountNumber, nextStep]
      );
      if (nextStep === "AWAITING_BUYER_LOCATION") {
        return "Now send buyer delivery coordinates: latitude,longitude";
      }
      if (nextStep === "AWAITING_SUPPLIER_HUB") {
        return "Now send supplier hub coordinates: latitude,longitude";
      }
      return `Registration complete! Your secure account ID is ${formatPublicMaskedId(
        user.user_type,
        user.masked_id
      )}.`;
    }

    if (user.current_step === "AWAITING_BUYER_LOCATION") {
      const coords = parseCoordinates(trimmed);
      if (!coords) {
        return "Invalid location format. Use: latitude,longitude";
      }
      await client.query(
        `
          UPDATE platform_users
          SET delivery_latitude = $2,
              delivery_longitude = $3,
              current_step = 'COMPLETED',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, coords.latitude, coords.longitude]
      );
      return `Registration complete! Your secure account ID is ${formatPublicMaskedId(
        user.user_type,
        user.masked_id
      )}. Type 'buy' to view offers.`;
    }

    if (user.current_step === "AWAITING_SUPPLIER_HUB") {
      const coords = parseCoordinates(trimmed);
      if (!coords) {
        return "Invalid location format. Use: latitude,longitude";
      }
      await client.query(
        `
          UPDATE platform_users
          SET hub_latitude = $2,
              hub_longitude = $3,
              current_step = 'AWAITING_CATALOG',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, coords.latitude, coords.longitude]
      );
      return (
        `Hub location saved. Seller ID ${formatPublicMaskedId(
          user.user_type,
          user.masked_id
        )}.\n` + "Now add your first item: Commodity, Price per bag"
      );
    }

    if (user.current_step === "AWAITING_CATALOG") {
      const parsedCatalog = parseCatalogLine(trimmed);
      if (!parsedCatalog) {
        return "Invalid format. Use: Commodity, Price per bag. Example: Onions, 1800";
      }
      await client.query(
        `
          INSERT INTO catalog_items (seller_masked_id, commodity_name, price_per_unit)
          VALUES ($1, $2, $3)
        `,
        [user.masked_id, parsedCatalog.commodity, parsedCatalog.price]
      );
      await client.query(
        `
          UPDATE platform_users
          SET current_step = 'COMPLETED',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return `Catalog item saved for Seller #${user.masked_id}. Buyers only see masked IDs.`;
    }

    await client.query(
      `
        UPDATE platform_users
        SET current_step = 'START',
            updated_at = NOW()
        WHERE id = $1
      `,
      [user.id]
    );
    return onboardingMenu();
  });
};

const handleIncomingWhatsapp = async (req, res, next) => {
  try {
    const rawMessage = (req.body.Body || "").trim();
    const communicationPhone = normalizeCommunicationPhone({
      from: req.body.From || "",
      waId: req.body.WaId || "",
    });
    const senderPhone = toPayoutPhone(communicationPhone);
    const senderName = req.body.ProfileName || "User";
    const lowerMessage = rawMessage.toLowerCase();

    if (!rawMessage) {
      return res.type("text/xml").send(twimlResponse(onboardingMenu()));
    }

    if (isAdminPhone(communicationPhone, senderPhone)) {
      const adminResponse = await handleAdminCommand(rawMessage, senderPhone);
      if (adminResponse) return res.type("text/xml").send(twimlResponse(adminResponse));
      return res
        .type("text/xml")
        .send(
          twimlResponse(
            "Admin commands: Release <OrderID>, Hold <OrderID>, Approve <OrderID>, Reject <OrderID>."
          )
        );
    }

    const user = await transaction(async (client) =>
      ensureUserRecord(client, communicationPhone)
    );

    if (user.current_step === "AWAITING_ORDER_CONFIRM") {
      if (rawMessage.trim() !== "1") {
        return res
          .type("text/xml")
          .send(twimlResponse("Reply 1 to confirm checkout and trigger STK Push."));
      }
      const confirmed = await confirmPendingOrderPayment({ user, senderPhone });
      return res.type("text/xml").send(
        twimlResponse(
          confirmed.alreadyInitiated
            ? `Payment prompt already initiated for order #${confirmed.orderId}.`
            : `Confirmed. STK Push sent for KSh ${confirmed.totalAmountKes.toLocaleString()}.`
        )
      );
    }

    if (!user.user_type || user.current_step !== "COMPLETED") {
      const onboardingResponse = await processOnboardingStep({
        user,
        rawMessage,
        senderPhone,
      });
      return res.type("text/xml").send(twimlResponse(onboardingResponse));
    }

    if (lowerMessage === "buy" || lowerMessage === "offers" || lowerMessage === "view") {
      return res.type("text/xml").send(twimlResponse(await listCatalogOffersMessage()));
    }

    if (user.user_type === "SUPPLIER" && rawMessage.includes(",")) {
      const parsedCatalog = parseCatalogLine(rawMessage);
      if (parsedCatalog) {
        await query(
          `
            INSERT INTO catalog_items (seller_masked_id, commodity_name, price_per_unit)
            VALUES ($1, $2, $3)
          `,
          [user.masked_id, parsedCatalog.commodity, parsedCatalog.price]
        );
        return res
          .type("text/xml")
          .send(twimlResponse(`Added ${parsedCatalog.commodity} at KSh ${parsedCatalog.price}.`));
      }
    }

    if (user.user_type === "BUYER") {
      const buyMatch = rawMessage.match(/^buy\s+(\d{5})\s+(\d+(?:\.\d+)?)$/i);
      if (buyMatch) {
        const payload = await createOrderFromCatalogRequest({
          buyer: user,
          senderPhone,
          rawMessage,
          sellerMaskedId: buyMatch[1],
          quantity: Number(buyMatch[2]),
        });

        return res.type("text/xml").send(
          twimlResponse(
            formatCheckoutSummary({
              quantity: buyMatch[2],
              commodityName: payload.catalogItem.commodity_name,
              unitMeasure: payload.catalogItem.unit_measure,
              unitPrice: payload.catalogItem.price_per_unit,
              itemSubtotal: payload.itemSubtotal,
              supplierHubLabel: payload.catalogItem.location_label,
              buyerDestinationLabel: `Buyer #${payload.buyer.masked_id} shop`,
              transport: payload.transport,
              totalAmount: payload.order.total_amount_kes,
            })
          )
        );
      }

      const refundMatch = rawMessage.match(/^refund\s+([a-zA-Z0-9-]+)(?:\s+(.+))?/i);
      if (refundMatch) {
        await requestOrderRefund({
          orderId: normalizeOrderIdFromText(refundMatch[1]),
          buyerMaskedId: user.masked_id,
          buyerPhone: senderPhone,
          reason: refundMatch[2] || null,
        });
        return res
          .type("text/xml")
          .send(twimlResponse("Refund request logged. Funds locked pending admin decision."));
      }
    }

    if (
      (user.user_type === "TRANSPORTER_BIKE" ||
        user.user_type === "TRANSPORTER_TRUCK") &&
      /^deliver\s+/i.test(rawMessage)
    ) {
      const deliverMatch = rawMessage.match(/^deliver\s+([a-zA-Z0-9-]+)\s+(\d{4})$/i);
      if (!deliverMatch) {
        return res
          .type("text/xml")
          .send(twimlResponse("Use format: Deliver <OrderID> <4-digit-OTP>"));
      }
      await verifyOtpAndQueueRelease({
        orderId: normalizeOrderIdFromText(deliverMatch[1]),
        otp: deliverMatch[2],
      });
      return res.type("text/xml").send(
        twimlResponse(
          "OTP verified. Order moved to AWAITING_RELEASE and sent to admin for final approval."
        )
      );
    }

    const legacyResult = await processLegacyAiOrder({
      rawMessage,
      senderPhone,
      senderName,
    });
    if (legacyResult.errorMessage) {
      return res.type("text/xml").send(twimlResponse(legacyResult.errorMessage));
    }

    const { payload } = legacyResult;
    const stkResponse = await initiateStkPush({
      phoneNumber: senderPhone,
      amount: payload.order.total_amount_kes,
      accountReference: `ORD-${payload.order.id.slice(0, 8)}`,
      transactionDesc: `AgizaHub ${payload.inventory.vendor_name}`,
    });

    await query(
      `
        INSERT INTO mpesa_stk_transactions (
          order_id, checkout_request_id, merchant_request_id, amount_kes, msisdn, status, raw_response
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
      `UPDATE orders SET mpesa_checkout_request_id = $2, updated_at = NOW() WHERE id = $1`,
      [payload.order.id, stkResponse.CheckoutRequestID]
    );

    return res.type("text/xml").send(
      twimlResponse(
        `Order ${payload.order.id.slice(0, 8)} imepokelewa. Lipa STK KES ${
          payload.order.total_amount_kes
        }. OTP: ${payload.otp}.`
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
