const { query, transaction } = require("../config/db");
const env = require("../config/env");
const logger = require("../services/logger");
const { sendGatewayReply } = require("../services/whatsappGatewayService");

const mapMetadata = (items = []) => {
  const values = {};
  for (const item of items) {
    values[item.Name] = item.Value;
  }
  return values;
};

const handleStkCallback = async (req, res, next) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) {
      return res.status(400).json({ error: "Invalid STK callback payload" });
    }

    const checkoutId = callback.CheckoutRequestID;
    const resultCode = Number(callback.ResultCode || -1);
    const metadata = mapMetadata(callback.CallbackMetadata?.Item || []);
    const mpesaReceipt = metadata.MpesaReceiptNumber || null;
    const amount = Number(metadata.Amount || 0);
    let buyerReceipt = null;
    let lowStockAlert = null;

    await transaction(async (client) => {
      const txnResult = await client.query(
        `
          SELECT *
          FROM mpesa_stk_transactions
          WHERE checkout_request_id = $1
          FOR UPDATE
        `,
        [checkoutId]
      );
      const txn = txnResult.rows[0] || null;
      const expectedAmount = Number(txn?.amount_kes || 0);
      const amountMismatch =
        resultCode === 0 &&
        expectedAmount > 0 &&
        Math.abs(Number(amount) - expectedAmount) > 0.5;

      let duplicateReceipt = false;
      if (resultCode === 0 && mpesaReceipt) {
        const duplicate = await client.query(
          `
            SELECT checkout_request_id
            FROM mpesa_stk_transactions
            WHERE mpesa_receipt_number = $2
              AND checkout_request_id <> $1
            LIMIT 1
          `,
          [checkoutId, mpesaReceipt]
        );
        duplicateReceipt = duplicate.rowCount > 0;
      }

      const resolvedStatus =
        resultCode === 0 && !amountMismatch && !duplicateReceipt ? "SUCCESS" : "FAILED";
      const resolvedResultDesc = amountMismatch
        ? `Amount mismatch: expected ${expectedAmount}, callback ${amount}`
        : duplicateReceipt
          ? "Duplicate M-Pesa receipt detected"
          : callback.ResultDesc || null;

      await client.query(
        `
          UPDATE mpesa_stk_transactions
          SET status = $2,
              result_code = $3,
              result_desc = $4,
              mpesa_receipt_number = $5,
              raw_callback = $6,
              updated_at = NOW()
          WHERE checkout_request_id = $1
        `,
        [
          checkoutId,
          resolvedStatus,
          String(resultCode),
          resolvedResultDesc,
          mpesaReceipt,
          JSON.stringify(req.body),
        ]
      );

      const orderResult = await client.query(
        `
          SELECT id, buyer_phone, buyer_masked_id, supplier_masked_id, catalog_item_id, quantity
          FROM orders
          WHERE mpesa_checkout_request_id = $1
          LIMIT 1
        `,
        [checkoutId]
      );
      if (orderResult.rowCount === 0) {
        return;
      }

      const orderId = orderResult.rows[0].id;
      if (resolvedStatus === "SUCCESS") {
        await client.query(
          `
            UPDATE orders
            SET payment_status = 'PAID_HELD',
                collected_amount = $2,
                mpesa_receipt_number = $3,
                updated_at = NOW()
            WHERE id = $1
          `,
          [orderId, amount, mpesaReceipt]
        );

        const order = orderResult.rows[0];
        const loyaltyPoints = Math.max(1, Math.floor(Number(amount || 0) / 100));
        if (order.buyer_masked_id) {
          await client.query(
            `
              INSERT INTO loyalty_wallets (buyer_masked_id, points_balance, updated_at)
              VALUES ($1, $2, NOW())
              ON CONFLICT (buyer_masked_id)
              DO UPDATE SET
                points_balance = loyalty_wallets.points_balance + $2,
                updated_at = NOW()
            `,
            [order.buyer_masked_id, loyaltyPoints]
          );
          await client.query(
            `
              INSERT INTO loyalty_points_ledger (
                buyer_masked_id,
                points_delta,
                reason,
                order_id,
                created_at
              )
              VALUES ($1, $2, 'Successful payment', $3, NOW())
            `,
            [order.buyer_masked_id, loyaltyPoints, orderId]
          );
        }

        if (order.catalog_item_id) {
          const stockResult = await client.query(
            `
              UPDATE catalog_items
              SET stock_quantity = GREATEST(stock_quantity - $2, 0),
                  updated_at = NOW()
              WHERE id = $1
              RETURNING commodity_name, stock_quantity, low_stock_threshold, seller_masked_id
            `,
            [order.catalog_item_id, Number(order.quantity || 0)]
          );
          if (stockResult.rowCount > 0) {
            const stock = stockResult.rows[0];
            if (Number(stock.stock_quantity || 0) <= Number(stock.low_stock_threshold || 0)) {
              const sellerResult = await client.query(
                `
                  SELECT phone_number
                  FROM platform_users
                  WHERE masked_id = $1
                  LIMIT 1
                `,
                [stock.seller_masked_id]
              );
              if (sellerResult.rowCount > 0 && sellerResult.rows[0].phone_number) {
                lowStockAlert = {
                  toPhone: sellerResult.rows[0].phone_number,
                  commodityName: stock.commodity_name,
                  remainingStock: Number(stock.stock_quantity || 0),
                  threshold: Number(stock.low_stock_threshold || 0),
                };
              }
            }
          }
        }

        buyerReceipt = {
          toPhone: order.buyer_phone,
          orderId,
          amount,
          mpesaReceipt,
          loyaltyPoints,
        };
      } else {
        await client.query(
          `
            UPDATE orders
            SET payment_status = 'PAYMENT_FAILED',
                dispute_reason = COALESCE($2, dispute_reason),
                updated_at = NOW()
            WHERE id = $1
          `,
          [orderId, resolvedResultDesc]
        );
      }
    });

    if (env.whatsappGateway.provider === "WAHA" && buyerReceipt?.toPhone) {
      await sendGatewayReply({
        provider: "WAHA",
        toPhone: buyerReceipt.toPhone,
        message: [
          "✅ Payment received and escrow secured.",
          `Order: #${buyerReceipt.orderId.slice(0, 8)}`,
          `Amount: KSh ${Number(buyerReceipt.amount || 0).toLocaleString()}`,
          `M-Pesa Receipt: ${buyerReceipt.mpesaReceipt || "N/A"}`,
          `Loyalty points earned: ${buyerReceipt.loyaltyPoints}`,
        ].join("\n"),
      });
    }

    if (env.whatsappGateway.provider === "WAHA" && lowStockAlert?.toPhone) {
      await sendGatewayReply({
        provider: "WAHA",
        toPhone: lowStockAlert.toPhone,
        message: [
          "⚠️ Low stock warning",
          `${lowStockAlert.commodityName} is now ${lowStockAlert.remainingStock} units.`,
          `Threshold: ${lowStockAlert.threshold}`,
          "Top up stock to avoid missed orders.",
        ].join("\n"),
      });
    }

    logger.info("Processed STK callback", {
      checkoutId,
      resultCode,
      amount,
      maxOrderAmountKes: env.security.maxOrderAmountKes,
    });
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  handleStkCallback,
};
