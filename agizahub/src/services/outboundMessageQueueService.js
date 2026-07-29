const { query } = require("../config/db");
const env = require("../config/env");
const logger = require("./logger");
const { sendGatewayReply } = require("./whatsappGatewayService");

const queueOutboundMessage = async ({ toPhone, message, interactiveList = null, error = null }) => {
  if (!toPhone || !message) return null;
  const result = await query(
    `
      INSERT INTO outbound_message_queue (
        to_phone,
        message_text,
        interactive_list,
        status,
        attempts,
        last_error,
        next_attempt_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, 'PENDING', 0, $4, NOW(), NOW(), NOW())
      RETURNING id
    `,
    [toPhone, message, interactiveList ? JSON.stringify(interactiveList) : null, error]
  );
  return result.rows?.[0]?.id || null;
};

const retryFailedOutboundMessages = async ({ limit = 25 } = {}) => {
  if (env.whatsappGateway.provider !== "WAHA") {
    return { scanned: 0, sent: 0, failed: 0, skipped: true };
  }
  const pending = await query(
    `
      SELECT id, to_phone, message_text, interactive_list, attempts
      FROM outbound_message_queue
      WHERE status = 'PENDING'
        AND next_attempt_at <= NOW()
      ORDER BY created_at ASC
      LIMIT $1
    `,
    [limit]
  );
  let sent = 0;
  let failed = 0;
  for (const row of pending.rows) {
    try {
      await sendGatewayReply({
        provider: "WAHA",
        toPhone: row.to_phone,
        message: row.message_text,
        interactiveList: row.interactive_list || null,
      });
      await query(
        `
          UPDATE outbound_message_queue
          SET status = 'SENT',
              attempts = attempts + 1,
              updated_at = NOW(),
              last_error = NULL
          WHERE id = $1
        `,
        [row.id]
      );
      sent += 1;
    } catch (error) {
      const nextAttempts = Number(row.attempts || 0) + 1;
      const finalFailure = nextAttempts >= 5;
      const delayMinutes = Math.min(30, Math.max(1, 2 ** Math.min(nextAttempts, 4)));
      await query(
        `
          UPDATE outbound_message_queue
          SET status = $2,
              attempts = $3,
              last_error = $4,
              next_attempt_at = CASE
                WHEN $2 = 'PENDING' THEN NOW() + ($5::text || ' minutes')::interval
                ELSE next_attempt_at
              END,
              updated_at = NOW()
          WHERE id = $1
        `,
        [row.id, finalFailure ? "FAILED" : "PENDING", nextAttempts, error.message, String(delayMinutes)]
      );
      failed += 1;
      logger.warn("Outbound queue send failed", {
        queueId: row.id,
        attempts: nextAttempts,
        error: error.message,
      });
    }
  }
  return {
    scanned: pending.rowCount,
    sent,
    failed,
    skipped: false,
  };
};

module.exports = {
  queueOutboundMessage,
  retryFailedOutboundMessages,
};
