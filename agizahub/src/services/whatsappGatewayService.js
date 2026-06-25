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

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const firstNonEmptyString = (...values) => {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
};

const isTrueLike = (value) => {
  if (value === true) return true;
  if (value === false) return false;
  if (value == null) return false;
  if (typeof value === "number") return value === 1;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
};

const parseTwilioInbound = (payload) => {
  const latitude = Number(payload.Latitude || payload.latitude || NaN);
  const longitude = Number(payload.Longitude || payload.longitude || NaN);
  const inboundLocation =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : null;

  const mediaCount = Number(payload.NumMedia || payload.numMedia || 0);
  const inboundMedia =
    mediaCount > 0
      ? {
          provider: "TWILIO",
          url: payload.MediaUrl0 || payload.mediaUrl0 || null,
          mimeType: payload.MediaContentType0 || payload.mediaContentType0 || null,
          fileName: payload.MediaFilename0 || payload.mediaFilename0 || null,
        }
      : null;

  const rawMessage = String(
    payload.Body ||
      (inboundLocation ? "__location_shared__" : "") ||
      (inboundMedia ? "__media_shared__" : "")
  ).trim();
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
    inboundMedia,
  };
};

const parseWahaInbound = (payload) => {
  const candidate = payload?.payload || payload?.message || payload;
  const fromMe = isTrueLike(
    firstDefined(
      candidate?.fromMe,
      candidate?.from_me,
      candidate?.key?.fromMe,
      payload?.fromMe,
      payload?.from_me,
      payload?.key?.fromMe
    )
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

  const mediaCandidate =
    candidate?.media ||
    candidate?.document ||
    candidate?.image ||
    candidate?.file ||
    payload?.media ||
    payload?.document ||
    payload?.image ||
    null;
  const mediaUrl =
    mediaCandidate?.url ||
    mediaCandidate?.link ||
    mediaCandidate?.downloadUrl ||
    mediaCandidate?.download_url ||
    candidate?.mediaUrl ||
    payload?.mediaUrl ||
    null;
  const mediaMimeType =
    mediaCandidate?.mimetype ||
    mediaCandidate?.mimeType ||
    candidate?.mimetype ||
    payload?.mimetype ||
    null;
  const mediaFileName =
    mediaCandidate?.filename ||
    mediaCandidate?.fileName ||
    mediaCandidate?.name ||
    candidate?.filename ||
    payload?.filename ||
    null;
  const inboundMedia =
    mediaUrl || mediaMimeType || mediaFileName
      ? {
          provider: "WAHA",
          url: mediaUrl,
          mimeType: mediaMimeType,
          fileName: mediaFileName,
        }
      : null;

  const rawMessage = firstNonEmptyString(
    candidate?.selectedRowId,
      candidate?.selectedRow?.id,
      candidate?.selectedButtonId ||
      candidate?.buttonId ||
      candidate?.listReply?.id ||
      candidate?.buttonReply?.id ||
    candidate?.body,
      candidate?.text,
      candidate?.text?.body,
      candidate?.message?.text,
      candidate?.message?.body,
      candidate?.message?.conversation,
      candidate?.message?.extendedTextMessage?.text,
      candidate?.message?.imageMessage?.caption,
      candidate?.message?.videoMessage?.caption,
      candidate?.message?.documentMessage?.caption,
      payload?.body,
      payload?.text,
      payload?.text?.body,
      payload?.message?.text,
      payload?.message?.body,
      payload?.message?.conversation,
      payload?.message?.extendedTextMessage?.text,
      payload?.payload?.body,
      payload?.payload?.text,
      inboundLocation ? "__location_shared__" : "",
      inboundMedia ? "__media_shared__" : ""
  );

  const senderRaw = firstNonEmptyString(
    candidate?.from,
    candidate?.fromNumber,
    candidate?.sender?.id,
    candidate?.sender?.phone,
    candidate?.author,
    candidate?.participant,
    candidate?.key?.remoteJid,
    payload?.from,
    payload?.chatId,
    payload?.author,
    payload?.participant,
    payload?.key?.remoteJid,
    payload?.payload?.from,
    payload?.payload?.chatId,
    payload?.payload?.author,
    payload?.payload?.participant,
    payload?.payload?.key?.remoteJid
  );

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
    senderName: firstNonEmptyString(
      candidate?.pushName,
      candidate?.senderName,
      candidate?.sender?.name,
      payload?.senderName,
      payload?.payload?.senderName,
      "User"
    ),
    inboundLocation,
    inboundMedia,
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
