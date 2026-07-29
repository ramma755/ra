const { query, transaction } = require("../config/db");

const runDailyReconciliation = async () => {
  return transaction(async (client) => {
    const runResult = await client.query(
      `
        INSERT INTO reconciliation_runs (run_type, status, started_at)
        VALUES ('DAILY', 'RUNNING', NOW())
        RETURNING id
      `
    );
    const runId = runResult.rows[0].id;

    const stalePayouts = await client.query(
      `
        SELECT d.id, d.order_id, d.status, d.created_at
        FROM mpesa_disbursements d
        WHERE d.status IN ('SUBMITTED', 'PENDING')
          AND d.created_at < NOW() - INTERVAL '30 minutes'
      `
    );

    for (const payout of stalePayouts.rows) {
      await client.query(
        `
          INSERT INTO reconciliation_exceptions (
            reconciliation_run_id,
            exception_type,
            reference_id,
            details
          )
          VALUES ($1, 'STALE_PAYOUT', $2, $3)
        `,
        [runId, payout.id, JSON.stringify(payout)]
      );
    }

    const stuckOrders = await client.query(
      `
        SELECT id, payment_status, settlement_status, distribution_status
        FROM orders
        WHERE payment_status = 'PAID_HELD'
          AND settlement_status NOT IN ('COMPLETED', 'FAILED')
          AND updated_at < NOW() - INTERVAL '1 hour'
      `
    );

    for (const order of stuckOrders.rows) {
      await client.query(
        `
          INSERT INTO reconciliation_exceptions (
            reconciliation_run_id,
            exception_type,
            reference_id,
            details
          )
          VALUES ($1, 'STUCK_SETTLEMENT', $2, $3)
        `,
        [runId, order.id, JSON.stringify(order)]
      );
    }

    await client.query(
      `
        UPDATE reconciliation_runs
        SET status = 'COMPLETED',
            finished_at = NOW(),
            exceptions_count = (
              SELECT COUNT(*)
              FROM reconciliation_exceptions
              WHERE reconciliation_run_id = $1
            )
        WHERE id = $1
      `,
      [runId]
    );

    return {
      runId,
      stalePayouts: stalePayouts.rowCount,
      stuckOrders: stuckOrders.rowCount,
    };
  });
};

module.exports = {
  runDailyReconciliation,
};
