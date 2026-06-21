const { query, transaction } = require("../config/db");
const env = require("../config/env");
const { submitBankSweep } = require("./treasuryProviderAdapter");
const { sendOpsAlert } = require("./alertService");

const runAutoSweep = async () => {
  const wallet = await query(
    `
      SELECT wallet_name, available_balance_kes
      FROM wallet_balances
      WHERE wallet_name = 'platform_commission'
    `
  );

  if (wallet.rowCount === 0) {
    return { skipped: true, reason: "No platform wallet balance record" };
  }

  const available = Number(wallet.rows[0].available_balance_kes || 0);
  const threshold = env.businessRules.treasurySweepThresholdKes;
  if (available < threshold) {
    return { skipped: true, reason: "Below threshold", available, threshold };
  }

  const sweepAmount = available;
  const sweep = await transaction(async (client) => {
    const insertResult = await client.query(
      `
        INSERT INTO treasury_sweeps (
          amount_kes,
          status,
          requested_by,
          approved_by
        )
        VALUES ($1, 'APPROVED', 'auto-sweep-job', 'auto-sweep-job')
        RETURNING id
      `,
      [sweepAmount]
    );

    await client.query(
      `
        UPDATE wallet_balances
        SET available_balance_kes = available_balance_kes - $1,
            updated_at = NOW()
        WHERE wallet_name = 'platform_commission'
      `,
      [sweepAmount]
    );

    return insertResult.rows[0];
  });

  try {
    const providerResult = await submitBankSweep({
      amountKes: sweepAmount,
      reference: sweep.id,
    });

    await query(
      `
        UPDATE treasury_sweeps
        SET status = 'SUBMITTED',
            provider_reference = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [sweep.id, providerResult.providerReference]
    );

    return { sweepId: sweep.id, amountKes: sweepAmount };
  } catch (error) {
    await query(
      `
        UPDATE treasury_sweeps
        SET status = 'FAILED',
            failure_reason = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [sweep.id, error.message.slice(0, 500)]
    );

    await sendOpsAlert({
      level: "critical",
      message: "Treasury sweep failed",
      payload: { sweepId: sweep.id, error: error.message },
    });
    throw error;
  }
};

module.exports = {
  runAutoSweep,
};
