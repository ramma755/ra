const axios = require("axios");
const env = require("../config/env");
const { normalizeMsisdn } = require("./darajaService");

const WA_PREFIX = "whatsapp:+";

const asCommunicationPhone = (msisdn) => `${WA_PREFIX}${normalizeMsisdn(msisdn)}`;

const normalizeSenderMsisdn = (rawValue) => {
  const cleaned = String(rawValue || "")
    .replace("whatsapp:", "")
    .replace(/@c\.us$/i, "")
    .replace(/@s\.whatsapp\.net$/i, "")
    .trim();
  return normalizeMsisdn(cleaned);
};

const parseTwilioInbound = (payload) => {
  const rawMessage = String(payload.Body || "").trim();
  const senderMsisdn = normalizeSenderMsisdn(payload.WaId || payload.From || "");

  if (!rawMessage || !senderMsisdn) {
    return {
      ignore: true,
      provider: "TWILIO",
      reason: "missing-twilio-message-or-sender",
    };
  }

  return {
    ignore: false,
    provider: "TWILIO",
    rawMessage,
    senderPhone: senderMsisdn,
    communicationPhone: asCommunicationPhone(senderMsisdn),
    senderName: payload.ProfileName || "User",
  };
};

const parseWahaInbound = (payload) => {
  const candidate = payload?.payload || payload?.message || payload;
  const fromMe = Boolean(
    candidate?.fromMe || candidate?.from_me || payload?.fromMe || payload?.from_me
  );
  if (fromMe) {
    return { ignore: true, provider: "WAHA", reason: "self-message" };
  }

  const rawMessage = String(
    candidate?.body ||
      candidate?.text ||
      candidate?.message?.text ||
      payload?.body ||
      payload?.text ||
      ""
  ).trim();

  const senderRaw =
    candidate?.from ||
    candidate?.fromNumber ||
    candidate?.sender?.id ||
    payload?.from ||
    payload?.chatId ||
    "";

  if (String(senderRaw).includes("@g.us")) {
    return { ignore: true, provider: "WAHA", reason: "group-message-ignored" };
  }

  const senderMsisdn = normalizeSenderMsisdn(senderRaw);
  if (!rawMessage || !senderMsisdn) {
    return {
      ignore: true,
      provider: "WAHA",
      reason: "missing-waha-message-or-sender",
    };
  }

  return {
    ignore: false,
    provider: "WAHA",
    rawMessage,
    senderPhone: senderMsisdn,
    communicationPhone: asCommunicationPhone(senderMsisdn),
    senderName:
      candidate?.pushName || candidate?.senderName || payload?.senderName || "User",
  };
};

const detectInboundProvider = (payload) => {
  if (payload && (payload.Body || payload.From || payload.WaId)) {
    return "TWILIO";
  }
  return "WAHA";
};

const parseInboundWhatsappPayload = (payload) => {
  const provider = detectInboundProvider(payload);
  if (provider === "TWILIO") {
    return parseTwilioInbound(payload);
  }
  return parseWahaInbound(payload);
};

const sendWahaMessage = async ({ toPhone, message }) => {
  const chatId = `${normalizeMsisdn(toPhone)}@c.us`;
  const headers = {
    "Content-Type": "application/json",
  };
  if (env.whatsappGateway.apiKey) {
    headers[env.whatsappGateway.wahaApiKeyHeader] = env.whatsappGateway.apiKey;
    headers.Authorization = `Bearer ${env.whatsappGateway.apiKey}`;
  }

  const base = env.whatsappGateway.wahaBaseUrl.replace(/\/$/, "");
  const path = env.whatsappGateway.wahaSendPath.startsWith("/")
    ? env.whatsappGateway.wahaSendPath
    : `/${env.whatsappGateway.wahaSendPath}`;
  const endpoint = `${base}${path}`;

  await axios.post(
    endpoint,
    {
      session: env.whatsappGateway.wahaSessionName,
      chatId,
      text: message,
    },
    {
      headers,
      timeout: 15000,
    }
  );
};

const sendGatewayReply = async ({ provider, toPhone, message }) => {
  if (provider === "WAHA") {
    await sendWahaMessage({ toPhone, message });
  }
};

module.exports = {
  parseInboundWhatsappPayload,
  sendGatewayReply,
};
