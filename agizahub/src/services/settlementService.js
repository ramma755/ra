const bcrypt = require("bcrypt");
const { query, transaction } = require("../config/db");
const env = require("../config/env");
const { dispatchLeg } = require("./payoutRouter");

const buildPayoutLegs = (order, vendor) => {
  const legs = [];

  if (Number(order.vendor_amount_kes) > 0) {
    legs.push({
      legKind: "VENDOR",
      recipientName: vendor.name,
      destinationType: vendor.wallet_type,
      destinationIdentifier: vendor.mpesa_identifier,
      amountKes: order.vendor_amount_kes,
      accountReference: vendor.account_reference || `ORD-${order.id.slice(0, 8)}`,
    });
  }

  if (order.transporter_phone && Number(order.driver_amount_kes) > 0) {
    legs.push({
      legKind: "DRIVER",
      recipientName: order.transporter_name || "Transporter",
      destinationType: "PHONE",
      destinationIdentifier: order.transporter_phone,
      amountKes: order.driver_amount_kes,
      accountReference: `DRV-${order.id.slice(0, 8)}`,
    });
  }

  return legs;
};

const refreshOrderDistributionStatus = async (orderId) => {
  const result = await query(
    `
      SELECT
        COUNT(*) AS total_legs,
        COUNT(*) FILTER (WHERE status = 'SUCCESS') AS successful_legs,
        COUNT(*) FILTER (WHERE status IN ('FAILED', 'TIMEOUT')) AS failed_legs
      FROM mpesa_payout_legs
      WHERE order_id = $1
    `,
    [orderId]
  );

  const summary = result.rows[0];
  const total = Number(summary.total_legs);
  const successful = Number(summary.successful_legs);
  const failed = Number(summary.failed_legs);

  if (total === 0) {
    return;
  }

  let distributionStatus = "IN_PROGRESS";
  let settlementStatus = "IN_PROGRESS";

  if (failed > 0) {
    distributionStatus = "FAILED";
    settlementStatus = "FAILED";
  } else if (successful === total) {
    distributionStatus = "COMPLETED";
    settlementStatus = "COMPLETED";
  }

  await query(
    `
      UPDATE orders
      SET distribution_status = $2,
          settlement_status = $3,
          updated_at = NOW()
      WHERE id = $1
    `,
    [orderId, distributionStatus, settlementStatus]
  );
};

const executePendingPayoutLegs = async (orderId) => {
  const legs = await query(
    `
      SELECT *
      FROM mpesa_payout_legs
      WHERE order_id = $1
        AND status = 'PENDING'
      ORDER BY created_at ASC
    `,
    [orderId]
  );

  for (const leg of legs.rows) {
    try {
      await dispatchLeg(leg);
    } catch (error) {
      await query(
        `
          UPDATE mpesa_payout_legs
          SET status = 'FAILED', failure_reason = $2, updated_at = NOW()
          WHERE id = $1
        `,
        [leg.id, error.message.slice(0, 500)]
      );
    }
  }

  await refreshOrderDistributionStatus(orderId);
};

const verifyOtpAndStartSettlement = async ({ orderId, otp }) => {
  const payload = await transaction(async (client) => {
    const orderResult = await client.query(
      `
        SELECT
          o.*,
          t.phone AS transporter_phone,
          t.name AS transporter_name
        FROM orders o
        LEFT JOIN transporters t ON t.id = o.transporter_id
        WHERE o.id = $1
        FOR UPDATE
      `,
      [orderId]
    );

    if (orderResult.rowCount === 0) {
      throw new Error("Order not found");
    }

    const order = orderResult.rows[0];

    if (order.payment_status !== "PAID_HELD") {
      throw new Error("Order has not been paid into escrow yet");
    }

    if (order.settlement_status === "COMPLETED") {
      throw new Error("Order is already settled");
    }

    if (!order.otp_code_hash || !order.otp_expires_at) {
      throw new Error("OTP was not initialized for this order");
    }

    if (new Date(order.otp_expires_at).getTime() < Date.now()) {
      throw new Error("OTP expired");
    }

    const otpOk = await bcrypt.compare(otp, order.otp_code_hash);
    if (!otpOk) {
      throw new Error("Invalid OTP");
    }

    const vendorResult = await client.query(
      `SELECT * FROM vendors WHERE id = $1`,
      [order.vendor_id]
    );
    if (vendorResult.rowCount === 0) {
      throw new Error("Order has no valid vendor");
    }

    const vendor = vendorResult.rows[0];
    const payoutLegs = buildPayoutLegs(order, vendor);

    for (const leg of payoutLegs) {
      await client.query(
        `
          INSERT INTO mpesa_payout_legs (
            order_id,
            leg_kind,
            recipient_name,
            destination_type,
            destination_identifier,
            amount_kes,
            account_reference,
            status
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING')
        `,
        [
          order.id,
          leg.legKind,
          leg.recipientName,
          leg.destinationType,
          leg.destinationIdentifier,
          leg.amountKes,
          leg.accountReference,
        ]
      );
    }

    const collectedAmount =
      Number(order.collected_amount || 0) || Number(order.total_amount_kes || 0);
    const platformAmount = Math.max(
      0,
      collectedAmount - Number(order.vendor_amount_kes) - Number(order.driver_amount_kes)
    );

    await client.query(
      `
        INSERT INTO wallet_balances (wallet_name, current_balance_kes, available_balance_kes)
        VALUES ('platform_commission', $1, $1)
        ON CONFLICT (wallet_name)
        DO UPDATE
          SET current_balance_kes = wallet_balances.current_balance_kes + EXCLUDED.current_balance_kes,
              available_balance_kes = wallet_balances.available_balance_kes + EXCLUDED.available_balance_kes,
              updated_at = NOW()
      `,
      [platformAmount]
    );

    await client.query(
      `
        UPDATE orders
        SET settlement_status = 'IN_PROGRESS',
            distribution_status = 'IN_PROGRESS',
            updated_at = NOW()
        WHERE id = $1
      `,
      [order.id]
    );

    return {
      orderId: order.id,
      payoutCount: payoutLegs.length,
      platformAmount,
      commissionPercent: env.businessRules.platformCommissionPercent,
    };
  });

  await executePendingPayoutLegs(orderId);
  return payload;
};

module.exports = {
  verifyOtpAndStartSettlement,
  executePendingPayoutLegs,
  refreshOrderDistributionStatus,
};
