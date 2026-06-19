const { query, transaction } = require("../config/db");
const logger = require("../services/logger");

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

    await transaction(async (client) => {
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
          resultCode === 0 ? "SUCCESS" : "FAILED",
          String(resultCode),
          callback.ResultDesc || null,
          mpesaReceipt,
          JSON.stringify(req.body),
        ]
      );

      const orderResult = await client.query(
        `
          SELECT id
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
      if (resultCode === 0) {
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
      } else {
        await client.query(
          `
            UPDATE orders
            SET payment_status = 'PAYMENT_FAILED',
                updated_at = NOW()
            WHERE id = $1
          `,
          [orderId]
        );
      }
    });

    logger.info("Processed STK callback", { checkoutId, resultCode });
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  handleStkCallback,
};
