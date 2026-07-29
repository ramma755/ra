const { query } = require("../config/db");
const { refreshOrderDistributionStatus } = require("../services/settlementService");
const logger = require("../services/logger");

const updateFromResult = async (resultPayload, status) => {
  const result = resultPayload?.Result || {};
  const originatorConversationId = result.OriginatorConversationID;
  const conversationId = result.ConversationID;
  const resultCode = Number(result.ResultCode || -1);
  const resolvedStatus = status || (resultCode === 0 ? "SUCCESS" : "FAILED");

  const update = await query(
    `
      UPDATE mpesa_disbursements
      SET status = $2,
          result_code = $3,
          result_desc = $4,
          conversation_id = COALESCE($5, conversation_id),
          originator_conversation_id = COALESCE($6, originator_conversation_id),
          raw_callback = $7,
          updated_at = NOW()
      WHERE originator_conversation_id = $1
         OR conversation_id = $5
      RETURNING id, order_id
    `,
    [
      originatorConversationId,
      resolvedStatus,
      String(resultCode),
      result.ResultDesc || null,
      conversationId || null,
      originatorConversationId || null,
      JSON.stringify(resultPayload),
    ]
  );

  for (const row of update.rows) {
    await query(
      `
        UPDATE mpesa_payout_legs
        SET status = $2,
            failure_reason = CASE WHEN $2 IN ('FAILED', 'TIMEOUT') THEN $3 ELSE NULL END,
            updated_at = NOW()
        WHERE mpesa_disbursement_id = $1
      `,
      [row.id, resolvedStatus, result.ResultDesc || null]
    );

    await refreshOrderDistributionStatus(row.order_id);
  }

  logger.info("Processed B2C callback", {
    originatorConversationId,
    conversationId,
    status: resolvedStatus,
    updatedRows: update.rowCount,
  });
};

const handleB2cResultCallback = async (req, res, next) => {
  try {
    await updateFromResult(req.body, null);
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    return next(error);
  }
};

const handleB2cTimeoutCallback = async (req, res, next) => {
  try {
    await updateFromResult(req.body, "TIMEOUT");
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  handleB2cResultCallback,
  handleB2cTimeoutCallback,
};
