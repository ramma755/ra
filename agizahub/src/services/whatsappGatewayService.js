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
  const latitude = Number(payload.Latitude || payload.latitude || NaN);
  const longitude = Number(payload.Longitude || payload.longitude || NaN);
  const inboundLocation =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : null;

  const rawMessage = String(payload.Body || (inboundLocation ? "__location_shared__" : "")).trim();
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
    inboundLocation,
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

  const locationPayload =
    candidate?.location ||
    candidate?.message?.location ||
    payload?.location ||
    null;
  const latitude = Number(
    locationPayload?.latitude || locationPayload?.lat || locationPayload?.y || NaN
  );
  const longitude = Number(
    locationPayload?.longitude || locationPayload?.lng || locationPayload?.x || NaN
  );
  const inboundLocation =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : null;

  const rawMessage = String(
    candidate?.selectedRowId ||
      candidate?.selectedButtonId ||
      candidate?.buttonId ||
      candidate?.listReply?.id ||
      candidate?.buttonReply?.id ||
    candidate?.body ||
      candidate?.text ||
      candidate?.message?.text ||
      payload?.body ||
      payload?.text ||
      (inboundLocation ? "__location_shared__" : "") ||
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
    inboundLocation,
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

const sendWahaInteractiveList = async ({ toPhone, interactiveList }) => {
  const chatId = `${normalizeMsisdn(toPhone)}@c.us`;
  const headers = {
    "Content-Type": "application/json",
  };
  if (env.whatsappGateway.apiKey) {
    headers[env.whatsappGateway.wahaApiKeyHeader] = env.whatsappGateway.apiKey;
    headers.Authorization = `Bearer ${env.whatsappGateway.apiKey}`;
  }

  const base = env.whatsappGateway.wahaBaseUrl.replace(/\/$/, "");
  const path = env.whatsappGateway.wahaListPath.startsWith("/")
    ? env.whatsappGateway.wahaListPath
    : `/${env.whatsappGateway.wahaListPath}`;
  const endpoint = `${base}${path}`;

  await axios.post(
    endpoint,
    {
      session: env.whatsappGateway.wahaSessionName,
      chatId,
      title: interactiveList.title,
      body: interactiveList.body,
      buttonText: interactiveList.buttonText || "Choose",
      sections: interactiveList.sections || [],
    },
    {
      headers,
      timeout: 15000,
    }
  );
};

const sendGatewayReply = async ({ provider, toPhone, message, interactiveList }) => {
  if (provider === "WAHA") {
    if (interactiveList) {
      try {
        await sendWahaInteractiveList({ toPhone, interactiveList });
        return;
      } catch (_error) {
        // Fallback to plain text if list API is unavailable.
      }
    }
    await sendWahaMessage({ toPhone, message });
  }
};

module.exports = {
  parseInboundWhatsappPayload,
  sendGatewayReply,
};
