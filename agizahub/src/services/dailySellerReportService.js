const { query } = require("../config/db");
const env = require("../config/env");
const logger = require("./logger");
const { sendGatewayReply } = require("./whatsappGatewayService");

const runDailySellerSalesReports = async () => {
  const salesResult = await query(
    `
      SELECT
        o.supplier_masked_id,
        u.phone_number,
        u.company_name,
        COUNT(*) AS orders_count,
        COALESCE(SUM(o.total_amount_kes), 0) AS gross_sales_kes
      FROM orders o
      JOIN platform_users u ON u.masked_id = o.supplier_masked_id
      WHERE o.created_at >= date_trunc('day', NOW())
        AND o.supplier_masked_id IS NOT NULL
        AND o.payment_status IN ('PAID_HELD', 'REFUND_REQUESTED', 'REFUNDED')
      GROUP BY o.supplier_masked_id, u.phone_number, u.company_name
    `
  );

  let sent = 0;
  let skipped = 0;
  for (const row of salesResult.rows) {
    if (!row.phone_number || env.whatsappGateway.provider !== "WAHA") {
      skipped += 1;
      continue;
    }
    const message = [
      "📊 Daily Sales Report",
      `Store: ${row.company_name || `Seller #${row.supplier_masked_id}`}`,
      `Orders today: ${Number(row.orders_count || 0).toLocaleString()}`,
      `Gross sales today: KSh ${Number(row.gross_sales_kes || 0).toLocaleString()}`,
      "Tip: Use 'my prices' and stock updates to keep catalog fresh.",
    ].join("\n");
    try {
      await sendGatewayReply({
        provider: "WAHA",
        toPhone: row.phone_number,
        message,
      });
      sent += 1;
    } catch (error) {
      logger.warn("Daily seller report send failed", {
        sellerMaskedId: row.supplier_masked_id,
        error: error.message,
      });
      skipped += 1;
    }
  }

  return {
    recipients: salesResult.rowCount,
    sent,
    skipped,
  };
};

module.exports = {
  runDailySellerSalesReports,
};
