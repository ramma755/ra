const { query } = require("../config/db");
const { sendB2CPayment, sendB2BPayment } = require("./darajaService");

const createDisbursementRecord = async (leg, channel, darajaResponse) => {
  const result = await query(
    `
      INSERT INTO mpesa_disbursements (
        order_id,
        leg_type,
        channel,
        destination_type,
        destination_identifier,
        amount_kes,
        conversation_id,
        originator_conversation_id,
        status,
        raw_response
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
    `,
    [
      leg.order_id,
      leg.leg_kind,
      channel,
      leg.destination_type,
      leg.destination_identifier,
      leg.amount_kes,
      darajaResponse.ConversationID || null,
      darajaResponse.OriginatorConversationID || null,
      "SUBMITTED",
      JSON.stringify(darajaResponse),
    ]
  );

  await query(
    `
      UPDATE mpesa_payout_legs
      SET mpesa_disbursement_id = $1, status = 'SUBMITTED', updated_at = NOW()
      WHERE id = $2
    `,
    [result.rows[0].id, leg.id]
  );

  return result.rows[0].id;
};

const dispatchLeg = async (leg) => {
  if (Number(leg.amount_kes) <= 0) {
    await query(
      `
        UPDATE mpesa_payout_legs
        SET status = 'SKIPPED', failure_reason = 'Zero amount', updated_at = NOW()
        WHERE id = $1
      `,
      [leg.id]
    );
    return null;
  }

  if (leg.destination_type === "PHONE") {
    const response = await sendB2CPayment({
      phoneNumber: leg.destination_identifier,
      amount: leg.amount_kes,
      remarks: `${leg.leg_kind} payout`,
      occasion: "AgizaHubSettlement",
    });
    return createDisbursementRecord(leg, "B2C", response);
  }

  const response = await sendB2BPayment({
    partyB: leg.destination_identifier,
    amount: leg.amount_kes,
    destinationType: leg.destination_type,
    accountReference: leg.account_reference,
    remarks: `${leg.leg_kind} payout`,
  });
  return createDisbursementRecord(leg, "B2B", response);
};

module.exports = {
  dispatchLeg,
};
