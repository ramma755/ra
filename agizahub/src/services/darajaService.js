const axios = require("axios");
const env = require("../config/env");

let tokenCache = {
  token: null,
  expiresAt: 0,
};

const normalizeMsisdn = (value) => {
  const digits = (value || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("7")) return `254${digits}`;
  return digits;
};

const getTimestamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
};

const getAccessToken = async () => {
  if (tokenCache.token && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  const auth = Buffer.from(
    `${env.daraja.consumerKey}:${env.daraja.consumerSecret}`
  ).toString("base64");

  const response = await axios.get(
    `${env.daraja.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 20000,
    }
  );

  const expiresInSeconds = Number(response.data.expires_in || 3599);
  tokenCache = {
    token: response.data.access_token,
    expiresAt: Date.now() + (expiresInSeconds - 60) * 1000,
  };
  return tokenCache.token;
};

const postDaraja = async (path, payload) => {
  const accessToken = await getAccessToken();
  const response = await axios.post(`${env.daraja.baseUrl}${path}`, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });
  return response.data;
};

const initiateStkPush = async ({
  phoneNumber,
  amount,
  accountReference,
  transactionDesc,
}) => {
  const timestamp = getTimestamp();
  const password = Buffer.from(
    `${env.daraja.shortcode}${env.daraja.passkey}${timestamp}`
  ).toString("base64");

  return postDaraja("/mpesa/stkpush/v1/processrequest", {
    BusinessShortCode: env.daraja.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: Math.ceil(Number(amount)),
    PartyA: normalizeMsisdn(phoneNumber),
    PartyB: env.daraja.shortcode,
    PhoneNumber: normalizeMsisdn(phoneNumber),
    CallBackURL: env.daraja.stkCallbackUrl,
    AccountReference: accountReference,
    TransactionDesc: transactionDesc || "AgizaHub escrow payment",
  });
};

const sendB2CPayment = async ({ phoneNumber, amount, remarks, occasion }) => {
  return postDaraja("/mpesa/b2c/v3/paymentrequest", {
    OriginatorConversationID: `agiza-${Date.now()}`,
    InitiatorName: env.daraja.initiatorName,
    SecurityCredential: env.daraja.initiatorPassword,
    CommandID: env.daraja.b2cCommandId,
    Amount: Math.ceil(Number(amount)),
    PartyA: env.daraja.shortcode,
    PartyB: normalizeMsisdn(phoneNumber),
    Remarks: remarks || "AgizaHub payout",
    QueueTimeOutURL: env.daraja.b2cTimeoutUrl,
    ResultURL: env.daraja.b2cResultUrl,
    Occasion: occasion || "Vendor settlement",
  });
};

const sendB2BPayment = async ({
  partyB,
  amount,
  destinationType,
  accountReference,
  remarks,
}) => {
  const commandId =
    destinationType === "TILL"
      ? env.daraja.b2bTillCommandId
      : env.daraja.b2bPaybillCommandId;

  return postDaraja("/mpesa/b2b/v1/paymentrequest", {
    Initiator: env.daraja.initiatorName,
    SecurityCredential: env.daraja.initiatorPassword,
    CommandID: commandId,
    SenderIdentifierType: "4",
    RecieverIdentifierType: destinationType === "TILL" ? "2" : "4",
    Amount: Math.ceil(Number(amount)),
    PartyA: env.daraja.shortcode,
    PartyB: partyB,
    AccountReference: accountReference || "AgizaHubSettlement",
    Remarks: remarks || "AgizaHub payout",
    QueueTimeOutURL: env.daraja.b2bTimeoutUrl,
    ResultURL: env.daraja.b2bResultUrl,
  });
};

module.exports = {
  normalizeMsisdn,
  initiateStkPush,
  sendB2CPayment,
  sendB2BPayment,
};
