const bcrypt = require("bcrypt");
const { query, transaction } = require("../config/db");
const env = require("../config/env");
const { dispatchLeg } = require("./payoutRouter");
const { normalizeMsisdn } = require("./darajaService");
const { resolveDisbursementFeeKes } = require("./mpesaFeeService");

const resolvePlatformUserDestination = (platformUser) => {
  const paymentMode = platformUser.payment_mode || "SEND_MONEY";

  if (paymentMode === "SEND_MONEY") {
    return {
      destinationType: "PHONE",
      destinationIdentifier:
        platformUser.payout_phone ||
        normalizeMsisdn((platformUser.phone_number || "").replace("whatsapp:+", "")),
      accountReference: platformUser.account_number || null,
    };
  }

  if (!platformUser.business_number) {
    throw new Error("Missing business number for merchant payout profile");
  }

  return {
    destinationType: paymentMode,
    destinationIdentifier: platformUser.business_number,
    accountReference: platformUser.account_number || platformUser.masked_id,
  };
};

const buildFeeAdjustedLeg = ({
  legKind,
  recipientName,
  destinationType,
  destinationIdentifier,
  grossAmountKes,
  accountReference,
}) => {
  const grossAmount = Number(Number(grossAmountKes || 0).toFixed(2));
  const processingFeeKes = resolveDisbursementFeeKes({
    amountKes: grossAmount,
    destinationType,
  });
  const netAmountKes = Number((grossAmount - processingFeeKes).toFixed(2));

  if (grossAmount <= 0) {
    return null;
  }
  if (netAmountKes <= 0) {
    throw new Error(
      `${legKind} payout amount (${grossAmount}) is too low after disbursement fee (${processingFeeKes})`
    );
  }

  return {
    legKind,
    recipientName,
    destinationType,
    destinationIdentifier,
    grossAmountKes: grossAmount,
    processingFeeKes,
    amountKes: netAmountKes,
    accountReference,
  };
};

const buildPayoutLegs = async (client, order) => {
  const legs = [];

  if (Number(order.vendor_amount_kes) > 0) {
    if (order.vendor_id) {
      const vendorResult = await client.query(`SELECT * FROM vendors WHERE id = $1`, [
        order.vendor_id,
      ]);
      if (vendorResult.rowCount === 0) {
        throw new Error("Order has no valid vendor");
      }
      const vendor = vendorResult.rows[0];
      const leg = buildFeeAdjustedLeg({
        legKind: "VENDOR",
        recipientName: vendor.name,
        destinationType: vendor.wallet_type,
        destinationIdentifier: vendor.mpesa_identifier,
        grossAmountKes: order.vendor_amount_kes,
        accountReference: vendor.account_reference || `ORD-${order.id.slice(0, 8)}`,
      });
      if (leg) legs.push(leg);
    } else if (order.supplier_masked_id) {
      const supplierResult = await client.query(
        `SELECT * FROM platform_users WHERE masked_id = $1`,
        [order.supplier_masked_id]
      );
      if (supplierResult.rowCount === 0) {
        throw new Error("Supplier payout profile not found");
      }
      const supplier = supplierResult.rows[0];
      const destination = resolvePlatformUserDestination(supplier);
      const leg = buildFeeAdjustedLeg({
        legKind: "VENDOR",
        recipientName: supplier.company_name || `Supplier #${order.supplier_masked_id}`,
        destinationType: destination.destinationType,
        destinationIdentifier: destination.destinationIdentifier,
        grossAmountKes: order.vendor_amount_kes,
        accountReference: destination.accountReference || `ORD-${order.id.slice(0, 8)}`,
      });
      if (leg) legs.push(leg);
    }
  }

  if (Number(order.driver_amount_kes) > 0) {
    if (order.transporter_id) {
      const transporterResult = await client.query(
        `SELECT name, phone FROM transporters WHERE id = $1`,
        [order.transporter_id]
      );
      if (transporterResult.rowCount > 0) {
        const transporter = transporterResult.rows[0];
        const leg = buildFeeAdjustedLeg({
          legKind: "DRIVER",
          recipientName: transporter.name || "Transporter",
          destinationType: "PHONE",
          destinationIdentifier: transporter.phone,
          grossAmountKes: order.driver_amount_kes,
          accountReference: `DRV-${order.id.slice(0, 8)}`,
        });
        if (leg) legs.push(leg);
      }
    } else if (order.transporter_masked_id) {
      const transporterUserResult = await client.query(
        `SELECT * FROM platform_users WHERE masked_id = $1`,
        [order.transporter_masked_id]
      );
      if (transporterUserResult.rowCount > 0) {
        const transporterUser = transporterUserResult.rows[0];
        const destination = resolvePlatformUserDestination(transporterUser);
        const leg = buildFeeAdjustedLeg({
          legKind: "DRIVER",
          recipientName:
            transporterUser.company_name || `Transporter #${order.transporter_masked_id}`,
          destinationType: destination.destinationType,
          destinationIdentifier: destination.destinationIdentifier,
          grossAmountKes: order.driver_amount_kes,
          accountReference: destination.accountReference || `DRV-${order.id.slice(0, 8)}`,
        });
        if (leg) legs.push(leg);
      }
    }
  }

  return legs;
};

const refreshOrderDistributionStatus = async (orderId) => {
  const result = await query(
    `
      SELECT
        COUNT(*) AS total_legs,
        COUNT(*) FILTER (WHERE status = 'SUCCESS') AS successful_legs,
        COUNT(*) FILTER (WHERE status IN ('FAILED', 'TIMEOUT')) AS failed_legs,
        COUNT(*) FILTER (WHERE leg_kind = 'REFUND') AS refund_legs
      FROM mpesa_payout_legs
      WHERE order_id = $1
    `,
    [orderId]
  );

  const summary = result.rows[0];
  const total = Number(summary.total_legs);
  const successful = Number(summary.successful_legs);
  const failed = Number(summary.failed_legs);
  const refundLegs = Number(summary.refund_legs);

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

  const paymentStatus =
    refundLegs > 0 && successful === total && failed === 0
      ? "REFUNDED"
      : undefined;

  await query(
    `
      UPDATE orders
      SET distribution_status = $2,
          settlement_status = $3,
          payment_status = COALESCE($4, payment_status),
          updated_at = NOW()
      WHERE id = $1
    `,
    [orderId, distributionStatus, settlementStatus, paymentStatus]
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

const verifyOtpAndQueueRelease = async ({ orderId, otp }) => {
  const payload = await transaction(async (client) => {
    const orderResult = await client.query(
      `
        SELECT o.*
        FROM orders o
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

    const normalizedOtp = String(otp || "").trim().toUpperCase();
    const otpOk = await bcrypt.compare(normalizedOtp, order.otp_code_hash);
    if (!otpOk) {
      throw new Error("Invalid OTP");
    }

    const existingLegs = await client.query(
      `
        SELECT id, processing_fee_kes
        FROM mpesa_payout_legs
        WHERE order_id = $1
          AND leg_kind IN ('VENDOR', 'DRIVER')
      `,
      [order.id]
    );

    let payoutLegs = [];
    if (existingLegs.rowCount === 0) {
      payoutLegs = await buildPayoutLegs(client, order);

      for (const leg of payoutLegs) {
        await client.query(
          `
            INSERT INTO mpesa_payout_legs (
              order_id,
              leg_kind,
              recipient_name,
              destination_type,
              destination_identifier,
              gross_amount_kes,
              processing_fee_kes,
              amount_kes,
              account_reference,
              status
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING')
          `,
          [
            order.id,
            leg.legKind,
            leg.recipientName,
            leg.destinationType,
            leg.destinationIdentifier,
            leg.grossAmountKes,
            leg.processingFeeKes,
            leg.amountKes,
            leg.accountReference,
          ]
        );
      }
    }

    const platformAmount = Number(order.platform_fee_kes || 0);
    const totalDisbursementFees = Number(
      (
        (payoutLegs.length > 0
          ? payoutLegs.reduce((sum, leg) => sum + Number(leg.processingFeeKes || 0), 0)
          : existingLegs.rows.reduce(
              (sum, row) => sum + Number(row.processing_fee_kes || 0),
              0
            )) || 0
      ).toFixed(2)
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

    if (totalDisbursementFees > 0) {
      await client.query(
        `
          INSERT INTO wallet_balances (wallet_name, current_balance_kes, available_balance_kes)
          VALUES ('disbursement_fee_reserve', $1, $1)
          ON CONFLICT (wallet_name)
          DO UPDATE
            SET current_balance_kes = wallet_balances.current_balance_kes + EXCLUDED.current_balance_kes,
                available_balance_kes = wallet_balances.available_balance_kes + EXCLUDED.available_balance_kes,
                updated_at = NOW()
        `,
        [totalDisbursementFees]
      );
    }

    await client.query(
      `
        UPDATE orders
        SET settlement_status = 'AWAITING_RELEASE',
            distribution_status = 'AWAITING_RELEASE',
            release_requested_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `,
      [order.id]
    );

    await client.query(
      `
        INSERT INTO admin_action_events (
          order_id,
          actor_phone,
          action_type,
          action_payload
        )
        VALUES ($1, $2, 'DELIVERY_OTP_VERIFIED', $3)
      `,
      [
        order.id,
        "system",
        JSON.stringify({
          orderId: order.id,
          settlementStatus: "AWAITING_RELEASE",
          totalDisbursementFees,
        }),
      ]
    );

    const legCount = payoutLegs.length || existingLegs.rowCount;

    return {
      orderId: order.id,
      payoutCount: legCount,
      platformAmount,
      totalDisbursementFees,
      commissionPercent: env.businessRules.matchingCommissionPercent,
      releaseRequired: true,
    };
  });

  return payload;
};

const releaseOrderByAdmin = async ({ orderId, actorPhone }) => {
  await transaction(async (client) => {
    const orderResult = await client.query(
      `
        SELECT *
        FROM orders
        WHERE id = $1
        FOR UPDATE
      `,
      [orderId]
    );
    if (orderResult.rowCount === 0) {
      throw new Error("Order not found");
    }

    const order = orderResult.rows[0];
    if (order.payment_status !== "PAID_HELD") {
      throw new Error("Only paid-held orders can be released");
    }
    if (!["AWAITING_RELEASE", "ON_HOLD", "IN_PROGRESS"].includes(order.settlement_status)) {
      throw new Error("Order is not in a releasable state");
    }

    await client.query(
      `
        UPDATE orders
        SET settlement_status = 'IN_PROGRESS',
            distribution_status = 'IN_PROGRESS',
            release_approved_at = NOW(),
            released_by_admin_phone = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [orderId, actorPhone]
    );

    await client.query(
      `
        INSERT INTO admin_action_events (
          order_id,
          actor_phone,
          action_type,
          action_payload
        )
        VALUES ($1, $2, 'RELEASE_APPROVED', $3)
      `,
      [orderId, actorPhone, JSON.stringify({ orderId })]
    );
  });

  await executePendingPayoutLegs(orderId);
  return { orderId, released: true };
};

const holdOrderByAdmin = async ({ orderId, actorPhone, note }) => {
  await transaction(async (client) => {
    const orderResult = await client.query(
      `
        SELECT id
        FROM orders
        WHERE id = $1
        FOR UPDATE
      `,
      [orderId]
    );
    if (orderResult.rowCount === 0) {
      throw new Error("Order not found");
    }

    await client.query(
      `
        UPDATE orders
        SET settlement_status = 'ON_HOLD',
            distribution_status = 'ON_HOLD',
            updated_at = NOW()
        WHERE id = $1
      `,
      [orderId]
    );

    await client.query(
      `
        INSERT INTO admin_action_events (
          order_id,
          actor_phone,
          action_type,
          action_payload
        )
        VALUES ($1, $2, 'RELEASE_HOLD', $3)
      `,
      [orderId, actorPhone, JSON.stringify({ note: note || null })]
    );
  });
  return { orderId, onHold: true };
};

const requestOrderRefund = async ({
  orderId,
  buyerMaskedId,
  buyerPhone,
  reason,
}) => {
  return transaction(async (client) => {
    const orderResult = await client.query(
      `
        SELECT *
        FROM orders
        WHERE id = $1
          AND (
            ($2::text IS NOT NULL AND buyer_masked_id = $2)
            OR buyer_phone = $3
          )
        FOR UPDATE
      `,
      [orderId, buyerMaskedId || null, buyerPhone]
    );
    if (orderResult.rowCount === 0) {
      throw new Error("Order not found for this buyer");
    }

    const order = orderResult.rows[0];
    if (!["PAID_HELD", "REFUND_REQUESTED"].includes(order.payment_status)) {
      throw new Error("Only paid orders can enter refund flow");
    }

    await client.query(
      `
        UPDATE orders
        SET payment_status = 'REFUND_REQUESTED',
            settlement_status = 'REFUND_IN_PROGRESS',
            distribution_status = 'ON_HOLD',
            refund_requested_at = NOW(),
            dispute_reason = COALESCE($2, dispute_reason),
            updated_at = NOW()
        WHERE id = $1
      `,
      [orderId, reason || null]
    );

    await client.query(
      `
        INSERT INTO admin_action_events (
          order_id,
          actor_phone,
          action_type,
          action_payload
        )
        VALUES ($1, $2, 'REFUND_REQUESTED', $3)
      `,
      [
        orderId,
        buyerPhone,
        JSON.stringify({
          reason: reason || null,
          buyerMaskedId: order.buyer_masked_id,
        }),
      ]
    );

    return { orderId, refundRequested: true };
  });
};

const approveRefundByAdmin = async ({ orderId, actorPhone }) => {
  await transaction(async (client) => {
    const orderResult = await client.query(
      `
        SELECT *
        FROM orders
        WHERE id = $1
        FOR UPDATE
      `,
      [orderId]
    );
    if (orderResult.rowCount === 0) {
      throw new Error("Order not found");
    }
    const order = orderResult.rows[0];
    if (order.payment_status !== "REFUND_REQUESTED") {
      throw new Error("Order is not pending refund approval");
    }

    let buyerProfile = null;
    if (order.buyer_masked_id) {
      const profileResult = await client.query(
        `SELECT * FROM platform_users WHERE masked_id = $1`,
        [order.buyer_masked_id]
      );
      buyerProfile = profileResult.rows[0] || null;
    }

    if (!buyerProfile) {
      const profileResult = await client.query(
        `SELECT * FROM platform_users WHERE phone_number = $1`,
        [`whatsapp:+${normalizeMsisdn(order.buyer_phone)}`]
      );
      buyerProfile = profileResult.rows[0] || null;
    }

    const destination = buyerProfile
      ? resolvePlatformUserDestination(buyerProfile)
      : {
          destinationType: "PHONE",
          destinationIdentifier: normalizeMsisdn(order.buyer_phone),
          accountReference: `RFND-${order.id.slice(0, 8)}`,
        };
    const refundLeg = buildFeeAdjustedLeg({
      legKind: "REFUND",
      recipientName: buyerProfile?.company_name || `Buyer #${order.buyer_masked_id || "N/A"}`,
      destinationType: destination.destinationType,
      destinationIdentifier: destination.destinationIdentifier,
      grossAmountKes: Number(order.collected_amount || order.total_amount_kes || 0),
      accountReference: destination.accountReference || `RFND-${order.id.slice(0, 8)}`,
    });
    if (!refundLeg) {
      throw new Error("Refund amount is zero");
    }

    await client.query(
      `
        INSERT INTO mpesa_payout_legs (
          order_id,
          leg_kind,
          recipient_name,
          destination_type,
          destination_identifier,
          gross_amount_kes,
          processing_fee_kes,
          amount_kes,
          account_reference,
          status
        )
        VALUES ($1, 'REFUND', $2, $3, $4, $5, $6, $7, $8, 'PENDING')
      `,
      [
        orderId,
        refundLeg.recipientName,
        refundLeg.destinationType,
        refundLeg.destinationIdentifier,
        refundLeg.grossAmountKes,
        refundLeg.processingFeeKes,
        refundLeg.amountKes,
        refundLeg.accountReference,
      ]
    );

    if (Number(refundLeg.processingFeeKes) > 0) {
      await client.query(
        `
          INSERT INTO wallet_balances (wallet_name, current_balance_kes, available_balance_kes)
          VALUES ('disbursement_fee_reserve', $1, $1)
          ON CONFLICT (wallet_name)
          DO UPDATE
            SET current_balance_kes = wallet_balances.current_balance_kes + EXCLUDED.current_balance_kes,
                available_balance_kes = wallet_balances.available_balance_kes + EXCLUDED.available_balance_kes,
                updated_at = NOW()
        `,
        [refundLeg.processingFeeKes]
      );
    }

    await client.query(
      `
        UPDATE orders
        SET settlement_status = 'IN_PROGRESS',
            distribution_status = 'IN_PROGRESS',
            refund_decision_at = NOW(),
            refund_decided_by_phone = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [orderId, actorPhone]
    );

    await client.query(
      `
        INSERT INTO admin_action_events (
          order_id,
          actor_phone,
          action_type,
          action_payload
        )
        VALUES ($1, $2, 'REFUND_APPROVED', $3)
      `,
      [orderId, actorPhone, JSON.stringify({ orderId })]
    );
  });

  await executePendingPayoutLegs(orderId);
  return { orderId, refundApproved: true };
};

const rejectRefundByAdmin = async ({ orderId, actorPhone }) => {
  return transaction(async (client) => {
    const orderResult = await client.query(
      `
        SELECT id, payment_status
        FROM orders
        WHERE id = $1
        FOR UPDATE
      `,
      [orderId]
    );
    if (orderResult.rowCount === 0) {
      throw new Error("Order not found");
    }

    if (orderResult.rows[0].payment_status !== "REFUND_REQUESTED") {
      throw new Error("Order is not pending refund decision");
    }

    await client.query(
      `
        UPDATE orders
        SET payment_status = 'PAID_HELD',
            settlement_status = 'AWAITING_RELEASE',
            distribution_status = 'AWAITING_RELEASE',
            refund_decision_at = NOW(),
            refund_decided_by_phone = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [orderId, actorPhone]
    );

    await client.query(
      `
        INSERT INTO admin_action_events (
          order_id,
          actor_phone,
          action_type,
          action_payload
        )
        VALUES ($1, $2, 'REFUND_REJECTED', $3)
      `,
      [orderId, actorPhone, JSON.stringify({ orderId })]
    );

    return { orderId, refundRejected: true };
  });
};

module.exports = {
  verifyOtpAndQueueRelease,
  releaseOrderByAdmin,
  holdOrderByAdmin,
  requestOrderRefund,
  approveRefundByAdmin,
  rejectRefundByAdmin,
  executePendingPayoutLegs,
  refreshOrderDistributionStatus,
};
