const { normalizeMsisdn } = require("./darajaService");

const COMMUNICATION_PREFIX = "whatsapp:+";

const normalizeCommunicationPhone = ({ from, waId }) => {
  if (from && from.startsWith(COMMUNICATION_PREFIX)) {
    return from;
  }
  const msisdn = normalizeMsisdn(waId || from || "");
  return `${COMMUNICATION_PREFIX}${msisdn}`;
};

const toPayoutPhone = (communicationPhone) => {
  const msisdn = normalizeMsisdn(
    (communicationPhone || "").replace(COMMUNICATION_PREFIX, "")
  );
  return msisdn;
};

const roleFromChoice = (choice) => {
  if (choice === "1") return "BUYER";
  if (choice === "2") return "SUPPLIER";
  if (choice === "3") return "TRANSPORTER_BIKE";
  if (choice === "4") return "TRANSPORTER_TRUCK";
  return null;
};

const rolePrefix = (userType) => {
  if (userType === "BUYER") return "B";
  if (userType === "SUPPLIER") return "S";
  if (userType === "TRANSPORTER_BIKE" || userType === "TRANSPORTER_TRUCK") {
    return "T";
  }
  return "U";
};

const formatPublicMaskedId = (userType, maskedId) =>
  `#${rolePrefix(userType)}${maskedId}`;

const generateMaskedId = async (client) => {
  for (let attempts = 0; attempts < 15; attempts += 1) {
    const candidate = String(Math.floor(Math.random() * 90000) + 10000);
    const existing = await client.query(
      `SELECT 1 FROM platform_users WHERE masked_id = $1`,
      [candidate]
    );
    if (existing.rowCount === 0) {
      return candidate;
    }
  }
  throw new Error("Unable to generate unique masked ID");
};

const findUserByPhone = async (client, phoneNumber) => {
  const result = await client.query(
    `
      SELECT *
      FROM platform_users
      WHERE phone_number = $1
      LIMIT 1
    `,
    [phoneNumber]
  );
  return result.rows[0] || null;
};

const ensureUserRecord = async (client, phoneNumber) => {
  const existing = await findUserByPhone(client, phoneNumber);
  if (existing) {
    return existing;
  }

  const maskedId = await generateMaskedId(client);
  const inserted = await client.query(
    `
      INSERT INTO platform_users (
        phone_number,
        masked_id,
        current_step
      )
      VALUES ($1, $2, 'START')
      RETURNING *
    `,
    [phoneNumber, maskedId]
  );
  return inserted.rows[0];
};

const paymentModeFromChoice = (choice) => {
  if (choice === "1") return "SEND_MONEY";
  if (choice === "2") return "TILL";
  if (choice === "3") return "PAYBILL";
  return null;
};

module.exports = {
  normalizeCommunicationPhone,
  toPayoutPhone,
  roleFromChoice,
  rolePrefix,
  formatPublicMaskedId,
  generateMaskedId,
  findUserByPhone,
  ensureUserRecord,
  paymentModeFromChoice,
};
