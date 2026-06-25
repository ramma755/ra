const axios = require("axios");
const env = require("../config/env");
const { normalizeMsisdn } = require("./darajaService");
const logger = require("./logger");

const WA_PREFIX = "whatsapp:+";

const normalizeGenericMsisdn = (rawValue) => {
  const digitsOnly = String(rawValue || "").replace(/[^\d]/g, "");
  if (digitsOnly.length >= 9 && digitsOnly.length <= 15) return digitsOnly;
  return "";
};

const normalizeForWhatsApp = (rawValue) =>
  normalizeMsisdn(rawValue) || normalizeGenericMsisdn(rawValue);

const asCommunicationPhone = (msisdn) => {
  const normalized = normalizeForWhatsApp(msisdn);
  return normalized ? `${WA_PREFIX}${normalized}` : "";
};

const extractPhoneLikeToken = (rawValue) => {
  const text = String(rawValue || "");
  if (!text) return "";

  const jidMatch = text.match(/(\d{9,15})(?::\d+)?@[a-z0-9.-]+/i);
  if (jidMatch?.[1]) return jidMatch[1];

  const patterns = [/\+?2540?[71]\d{8}/g, /0[71]\d{8}/g, /[71]\d{8}/g, /\d{9,15}/g];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0];
  }
  return "";
};

const normalizeSenderMsisdn = (rawValue) => {
  const cleaned = String(rawValue || "")
    .replace("whatsapp:", "")
    .replace(/:\d+@/g, "@")
    .replace(/@[a-z0-9._-]+$/i, "")
    .trim();
  const direct = normalizeForWhatsApp(cleaned);
  if (direct) return direct;

  const extracted = extractPhoneLikeToken(`${cleaned} ${String(rawValue || "")}`);
  if (!extracted) return "";
  return normalizeForWhatsApp(extracted);
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const resolveWahaEndpoint = (baseUrl, path) => {
  const base = String(baseUrl || "").replace(/\/$/, "");
  const normalizedPath = String(path || "").startsWith("/") ? String(path || "") : `/${path || ""}`;
  if (!base) return normalizedPath;
  if (base.endsWith("/api") && normalizedPath.startsWith("/api/")) {
    return `${base}${normalizedPath.slice(4)}`;
  }
  return `${base}${normalizedPath}`;
};

const coerceInboundPayload = (rawPayload) => {
  if (rawPayload == null) return {};
  if (Buffer.isBuffer(rawPayload)) {
    const asText = rawPayload.toString("utf8").trim();
    if (!asText) return {};
    try {
      return JSON.parse(asText);
    } catch (_error) {
      return { text: asText, body: asText };
    }
  }
  if (typeof rawPayload === "string") {
    const trimmed = rawPayload.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      return { text: trimmed, body: trimmed };
    }
  }
  if (typeof rawPayload === "object") return rawPayload;
  return {};
};

const collectObjectNodes = (root, maxDepth = 5, maxNodes = 120) => {
  const nodes = [];
  const queue = [{ value: root, depth: 0 }];
  const seen = new Set();

  while (queue.length > 0 && nodes.length < maxNodes) {
    const entry = queue.shift();
    const value = entry?.value;
    const depth = Number(entry?.depth || 0);
    if (!value || typeof value !== "object") continue;
    if (seen.has(value)) continue;
    seen.add(value);
    nodes.push(value);
    if (depth >= maxDepth) continue;

    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) {
      if (child && typeof child === "object") {
        queue.push({ value: child, depth: depth + 1 });
      }
    }
  }

  return nodes;
};

const firstDefinedFromNodes = (nodes, getter) => {
  for (const node of nodes) {
    const value = getter(node);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

const valueToText = (value, depth = 0) => {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (depth >= 3) return "";

  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = valueToText(entry, depth + 1);
      if (parsed) return parsed;
    }
    return "";
  }

  if (typeof value === "object") {
    const commonTextKeys = [
      "text",
      "body",
      "conversation",
      "caption",
      "content",
      "remoteJid",
      "jid",
      "phone",
      "number",
      "from",
    ];
    for (const key of commonTextKeys) {
      const parsed = valueToText(value[key], depth + 1);
      if (parsed) return parsed;
    }
  }

  return "";
};

const firstNonEmptyString = (...values) => {
  for (const value of values) {
    const normalized = valueToText(value);
    if (normalized) return normalized;
  }
  return "";
};

const firstNonEmptyStringFromNodes = (nodes, getter) => {
  for (const node of nodes) {
    const normalized = valueToText(getter(node));
    if (normalized) return normalized;
  }
  return "";
};

const isLikelySenderToken = (value) => {
  const text = valueToText(value);
  if (!text) return false;
  return Boolean(
    text.match(/(\d{9,15})(?::\d+)?@(c\.us|s\.whatsapp\.net)/i) ||
      text.match(/\+?254[71]\d{8}/) ||
      text.match(/0[71]\d{8}/) ||
      text.match(/[71]\d{8}/)
  );
};

const firstLikelySenderFromNodes = (nodes, getter) => {
  for (const node of nodes) {
    const value = getter(node);
    if (isLikelySenderToken(value)) return valueToText(value);
  }
  return "";
};

const fallbackSenderFromSerializedPayload = (payload) => {
  let serialized = "";
  try {
    serialized = JSON.stringify(payload || {});
  } catch (_error) {
    return "";
  }
  if (!serialized) return "";

  const jidMatch = serialized.match(/(\d{9,15})(?::\d+)?@[a-z0-9.-]+/i);
  if (jidMatch?.[1]) return jidMatch[1];

  const plusMatch = serialized.match(/\+?2540?[71]\d{8}/);
  if (plusMatch?.[0]) return plusMatch[0];

  const genericMatch = serialized.match(/\b\d{9,15}\b/);
  if (genericMatch?.[0]) return genericMatch[0];

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
  const normalizedPayload = coerceInboundPayload(payload);
  const eventType = String(
    normalizedPayload?.event || normalizedPayload?.type || normalizedPayload?.eventType || ""
  )
    .trim()
    .toLowerCase();
  if (
    eventType &&
    ![
      "message",
      "message.any",
      "messages.upsert",
      "messages",
      "message.upsert",
      "message_create",
      "message.created",
    ].includes(eventType)
  ) {
    return { ignore: true, provider: "WAHA", reason: `non-message-event:${eventType}` };
  }

  const candidate =
    normalizedPayload?.payload || normalizedPayload?.message || normalizedPayload;
  const nodes = collectObjectNodes(normalizedPayload);
  const fromMe = isTrueLike(
    firstDefinedFromNodes(nodes, (node) =>
      firstDefined(
        node?.fromMe,
        node?.from_me,
        node?.key?.fromMe,
        node?.key?.from_me,
        node?.message?.key?.fromMe,
        node?.message?.key?.from_me,
        node?._data?.key?.fromMe
      )
    )
  );
  if (fromMe) {
    return { ignore: true, provider: "WAHA", reason: "self-message" };
  }

  const locationPayload = firstDefinedFromNodes(nodes, (node) =>
    firstDefined(
      node?.location,
      node?.message?.location,
      node?.message?.liveLocationMessage,
      node?.message?.ephemeralMessage?.message?.location,
      node?.message?.ephemeralMessage?.message?.liveLocationMessage
    )
  );
  const latitude = Number(
    firstDefined(
      locationPayload?.latitude,
      locationPayload?.lat,
      locationPayload?.degreesLatitude,
      locationPayload?.y,
      NaN
    )
  );
  const longitude = Number(
    firstDefined(
      locationPayload?.longitude,
      locationPayload?.lng,
      locationPayload?.degreesLongitude,
      locationPayload?.x,
      NaN
    )
  );
  const inboundLocation =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : null;

  const mediaCandidate = firstDefinedFromNodes(nodes, (node) =>
    firstDefined(
      node?.media,
      node?.document,
      node?.image,
      node?.file,
      node?.message?.imageMessage,
      node?.message?.videoMessage,
      node?.message?.documentMessage,
      node?.message?.audioMessage,
      node?.message?.ephemeralMessage?.message?.imageMessage,
      node?.message?.ephemeralMessage?.message?.videoMessage,
      node?.message?.ephemeralMessage?.message?.documentMessage
    )
  );
  const mediaUrl =
    mediaCandidate?.url ||
    mediaCandidate?.link ||
    mediaCandidate?.downloadUrl ||
    mediaCandidate?.download_url ||
    mediaCandidate?.directPath ||
    mediaCandidate?.fileUrl ||
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
    firstNonEmptyStringFromNodes(nodes, (node) =>
      firstDefined(
        node?.selectedRowId,
        node?.selectedRow?.id,
        node?.selectedButtonId,
        node?.buttonId,
        node?.listReply?.id,
        node?.buttonReply?.id,
        node?.message?.listResponseMessage?.singleSelectReply?.selectedRowId,
        node?.message?.buttonsResponseMessage?.selectedButtonId,
        node?.message?.templateButtonReplyMessage?.selectedId,
        node?.body,
        node?.text,
        node?.text?.body,
        node?.caption,
        node?.message?.text,
        node?.message?.body,
        node?.message?.conversation,
        node?.message?.extendedTextMessage?.text,
        node?.message?.imageMessage?.caption,
        node?.message?.videoMessage?.caption,
        node?.message?.documentMessage?.caption,
        node?.message?.ephemeralMessage?.message?.conversation,
        node?.message?.ephemeralMessage?.message?.extendedTextMessage?.text,
        node?.message?.ephemeralMessage?.message?.imageMessage?.caption,
        node?.message?.ephemeralMessage?.message?.videoMessage?.caption,
        node?.message?.ephemeralMessage?.message?.documentMessage?.caption
      )
    ),
    inboundLocation ? "__location_shared__" : "",
    inboundMedia ? "__media_shared__" : ""
  );

  let senderRaw = firstNonEmptyString(
    firstLikelySenderFromNodes(nodes, (node) =>
      firstDefined(
        node?._data?.key?.remoteJidAlt,
        node?._data?.key?.participantPn,
        node?._data?.key?.remoteJid,
        node?.key?.remoteJid,
        node?.key?.participant,
        node?.key?.participantPn,
        node?.key?.from,
        node?.from,
        node?.fromNumber,
        node?.chatId,
        node?.author,
        node?.participant,
        node?.sender?.id,
        node?.sender?.phone,
        node?.sender?.waId,
        node?.sender?.jid,
        node?.fromJid,
        node?.message?.key?.remoteJid,
        node?.message?.key?.participant
      )
    ),
    firstNonEmptyStringFromNodes(nodes, (node) =>
      firstDefined(
        node?._data?.key?.remoteJidAlt,
        node?._data?.key?.participantPn,
        node?._data?.key?.remoteJid,
        node?.key?.remoteJid,
        node?.key?.participant,
        node?.key?.participantPn,
        node?.key?.from,
        node?.from,
        node?.fromNumber,
        node?.chatId,
        node?.author,
        node?.participant,
        node?.sender?.id,
        node?.sender?.phone,
        node?.sender?.waId,
        node?.sender?.jid,
        node?.fromJid,
        node?.message?.key?.remoteJid,
        node?.message?.key?.participant
      )
    )
  );
  if (!senderRaw) {
    senderRaw = fallbackSenderFromSerializedPayload(normalizedPayload);
  }

  if (String(senderRaw).includes("@g.us")) {
    return { ignore: true, provider: "WAHA", reason: "group-message-ignored" };
  }

  const senderMsisdn = normalizeSenderMsisdn(senderRaw);
  if (!rawMessage || !senderMsisdn) {
    const topLevelKeys =
      normalizedPayload && typeof normalizedPayload === "object" && !Array.isArray(normalizedPayload)
        ? Object.keys(normalizedPayload).slice(0, 10).join("|")
        : "none";
    const senderPreview = String(senderRaw || "")
      .replace(/\d(?=\d{4})/g, "*")
      .slice(0, 60);
    return {
      ignore: true,
      provider: "WAHA",
      reason: `missing-waha-message-or-sender(rawMessage=${rawMessage ? "yes" : "no"}, senderRaw=${
        senderRaw ? "yes" : "no"
      }, senderMsisdn=${senderMsisdn ? "yes" : "no"}, senderPreview=${senderPreview || "none"}, topKeys=${topLevelKeys})`,
    };
  }

  return {
    ignore: false,
    provider: "WAHA",
    rawMessage,
    senderPhone: senderMsisdn,
    communicationPhone: asCommunicationPhone(senderMsisdn),
    senderName: firstNonEmptyString(
      firstNonEmptyStringFromNodes(nodes, (node) =>
        firstDefined(
          node?.pushName,
          node?.senderName,
          node?.sender?.name,
          node?.contact?.name
        )
      ),
      "User"
    ),
    inboundLocation,
    inboundMedia,
  };
};

const detectInboundProvider = (payload) => {
  const normalizedPayload = coerceInboundPayload(payload);
  if (normalizedPayload && (normalizedPayload.Body || normalizedPayload.From || normalizedPayload.WaId)) {
    return "TWILIO";
  }
  return "WAHA";
};

const parseInboundWhatsappPayload = (payload) => {
  const normalizedPayload = coerceInboundPayload(payload);
  const provider = detectInboundProvider(normalizedPayload);
  if (provider === "TWILIO") {
    return parseTwilioInbound(normalizedPayload);
  }
  return parseWahaInbound(normalizedPayload);
};

const sendWahaMessage = async ({ toPhone, message }) => {
  const resolvedPhone = normalizeForWhatsApp(toPhone);
  if (!resolvedPhone) {
    throw new Error("Cannot send WAHA message: invalid destination phone");
  }
  const chatId = `${resolvedPhone}@c.us`;
  const headers = {
    "Content-Type": "application/json",
  };
  if (env.whatsappGateway.apiKey) {
    headers[env.whatsappGateway.wahaApiKeyHeader] = env.whatsappGateway.apiKey;
    headers.Authorization = `Bearer ${env.whatsappGateway.apiKey}`;
  }

  const endpoint = resolveWahaEndpoint(
    env.whatsappGateway.wahaBaseUrl,
    env.whatsappGateway.wahaSendPath
  );

  logger.info("Sending WAHA text reply", {
    endpoint,
    to: `${resolvedPhone.slice(0, 3)}***${resolvedPhone.slice(-3)}`,
  });
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
  const resolvedPhone = normalizeForWhatsApp(toPhone);
  if (!resolvedPhone) {
    throw new Error("Cannot send WAHA interactive list: invalid destination phone");
  }
  const chatId = `${resolvedPhone}@c.us`;
  const headers = {
    "Content-Type": "application/json",
  };
  if (env.whatsappGateway.apiKey) {
    headers[env.whatsappGateway.wahaApiKeyHeader] = env.whatsappGateway.apiKey;
    headers.Authorization = `Bearer ${env.whatsappGateway.apiKey}`;
  }

  const endpoint = resolveWahaEndpoint(
    env.whatsappGateway.wahaBaseUrl,
    env.whatsappGateway.wahaListPath
  );

  logger.info("Sending WAHA list reply", {
    endpoint,
    to: `${resolvedPhone.slice(0, 3)}***${resolvedPhone.slice(-3)}`,
  });
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
