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

const parseOpenWaInbound = (payload) => {
  const candidate = payload?.data || payload?.payload || payload?.message || payload;
  const fromMe = Boolean(
    candidate?.fromMe ||
      candidate?.from_me ||
      candidate?.isFromMe ||
      payload?.fromMe ||
      payload?.from_me
  );
  if (fromMe) {
    return { ignore: true, provider: "OPENWA", reason: "self-message" };
  }

  const rawMessage = String(
    candidate?.body ||
      candidate?.content ||
      candidate?.text ||
      candidate?.message?.text ||
      candidate?.message?.body ||
      payload?.body ||
      payload?.text ||
      payload?.content ||
      ""
  ).trim();

  const senderRaw =
    candidate?.from ||
    candidate?.chatId ||
    candidate?.chat?.id ||
    candidate?.author ||
    candidate?.sender?.id ||
    payload?.from ||
    payload?.chatId ||
    "";

  if (String(senderRaw).includes("@g.us")) {
    return { ignore: true, provider: "OPENWA", reason: "group-message-ignored" };
  }

  const senderMsisdn = normalizeSenderMsisdn(senderRaw);
  if (!rawMessage || !senderMsisdn) {
    return {
      ignore: true,
      provider: "OPENWA",
      reason: "missing-openwa-message-or-sender",
    };
  }

  return {
    ignore: false,
    provider: "OPENWA",
    rawMessage,
    senderPhone: senderMsisdn,
    communicationPhone: asCommunicationPhone(senderMsisdn),
    senderName:
      candidate?.notifyName ||
      candidate?.pushName ||
      candidate?.senderName ||
      payload?.senderName ||
      "User",
  };
};

const parseWahaInbound = (payload) => {
  const parsed = parseOpenWaInbound(payload);
  return {
    ...parsed,
    provider: parsed.ignore ? "WAHA" : "WAHA",
  };
};

const detectInboundProvider = (payload) => {
  if (payload && (payload.Body || payload.From || payload.WaId)) {
    return "TWILIO";
  }
  const preferred = env.whatsappGateway.provider;
  if (preferred === "WAHA") return "WAHA";
  return "OPENWA";
};

const parseInboundWhatsappPayload = (payload) => {
  const provider = detectInboundProvider(payload);
  if (provider === "TWILIO") return parseTwilioInbound(payload);
  if (provider === "WAHA") return parseWahaInbound(payload);
  return parseOpenWaInbound(payload);
};

const buildOpenWaHeaders = () => {
  const headers = {
    "Content-Type": "application/json",
  };
  if (env.whatsappGateway.apiKey) {
    headers[env.whatsappGateway.openwaApiKeyHeader] = env.whatsappGateway.apiKey;
    headers.Authorization = `Bearer ${env.whatsappGateway.apiKey}`;
  }
  return headers;
};

const sendOpenWaMessage = async ({ toPhone, message }) => {
  const chatId = `${normalizeMsisdn(toPhone)}@c.us`;
  const base = env.whatsappGateway.openwaBaseUrl.replace(/\/$/, "");
  const path = env.whatsappGateway.openwaSendPath.startsWith("/")
    ? env.whatsappGateway.openwaSendPath
    : `/${env.whatsappGateway.openwaSendPath}`;
  const endpoint = `${base}${path}`;

  let body = {
    to: chatId,
    content: message,
    text: message,
    chatId,
  };
  if (env.whatsappGateway.openwaSendMode === "ARGS") {
    body = {
      args: [chatId, message],
    };
  }

  await axios.post(endpoint, body, {
    headers: buildOpenWaHeaders(),
    timeout: 15000,
  });
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
  if (provider === "OPENWA") {
    await sendOpenWaMessage({ toPhone, message });
    return;
  }
  if (provider === "WAHA") {
    await sendWahaMessage({ toPhone, message });
  }
};

module.exports = {
  parseInboundWhatsappPayload,
  sendGatewayReply,
};
