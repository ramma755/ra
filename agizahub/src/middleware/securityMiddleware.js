const env = require("../config/env");
const { query } = require("../config/db");
const logger = require("../services/logger");

const normalizeIp = (rawIp) =>
  String(rawIp || "")
    .trim()
    .replace(/^::ffff:/i, "")
    .replace(/^\[|\]$/g, "");

const getCallerIp = (req) => {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (forwarded.length > 0) return normalizeIp(forwarded[0]);
  return normalizeIp(req.ip || req.socket?.remoteAddress || "");
};

const parseIpv4 = (ip) => {
  const parts = String(ip || "")
    .split(".")
    .map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + parts[3];
};

const isIpInCidr = (ip, cidr) => {
  const [range, prefixRaw] = String(cidr || "").split("/");
  const prefix = Number(prefixRaw);
  const ipLong = parseIpv4(ip);
  const rangeLong = parseIpv4(range);
  if (ipLong == null || rangeLong == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipLong & mask) === (rangeLong & mask);
};

const ipAllowed = (ip, allowedEntries) => {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) return false;
  for (const entry of allowedEntries || []) {
    if (!entry) continue;
    if (entry.includes("/")) {
      if (isIpInCidr(normalizedIp, entry)) return true;
    } else if (normalizeIp(entry) === normalizedIp) {
      return true;
    }
  }
  return false;
};

const sanitizeHeaders = (headers = {}) => {
  const blocked = new Set(["authorization", "x-api-key", "cookie", "set-cookie"]);
  const redacted = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = blocked.has(String(key).toLowerCase()) ? "[REDACTED]" : value;
  }
  return redacted;
};

const logInboundWebhook = ({ source }) => async (req, _res, next) => {
  const callerIp = getCallerIp(req);
  const payload = env.security.webhookLogPayloads ? req.body || {} : {};
  logger.info("Inbound webhook received", {
    source,
    path: req.path,
    callerIp,
    userAgent: req.headers["user-agent"] || "unknown",
  });

  try {
    await query(
      `
        INSERT INTO webhook_request_logs (
          source,
          route_path,
          method,
          caller_ip,
          status,
          headers,
          payload
        )
        VALUES ($1,$2,$3,$4,'RECEIVED',$5,$6)
      `,
      [
        source,
        req.path,
        req.method,
        callerIp || null,
        JSON.stringify(sanitizeHeaders(req.headers || {})),
        JSON.stringify(payload),
      ]
    );
  } catch (error) {
    logger.warn("Failed to persist webhook log", { source, error: error.message });
  }

  return next();
};

const enforceHttpsAndCors = (req, res, next) => {
  const allowedOrigins = env.security.corsAllowedOrigins || [];
  const origin = String(req.headers.origin || "");
  if (origin && allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (env.nodeEnv === "production" && env.security.blockNonHttpsRequests) {
    const protocol = String(req.headers["x-forwarded-proto"] || req.protocol || "").toLowerCase();
    if (protocol !== "https" && req.path !== "/health") {
      return res.status(403).json({ error: "HTTPS required" });
    }
  }
  return next();
};

const extractBearerToken = (authorizationHeader) => {
  const raw = String(authorizationHeader || "");
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
};

const requireWahaWebhookAuth = (req, res, next) => {
  if (env.whatsappGateway.provider !== "WAHA") return next();
  const expectedSecret = env.whatsappGateway.webhookSecret || env.whatsappGateway.apiKey;
  if (!expectedSecret) return next();

  const provided =
    String(req.headers["x-api-key"] || req.headers["x-waha-api-key"] || "").trim() ||
    extractBearerToken(req.headers.authorization);

  if (!provided || provided !== expectedSecret) {
    logger.warn("WAHA webhook auth mismatch (allowing for uptime)", {
      callerIp: getCallerIp(req),
      path: req.path,
      provided: provided ? "yes" : "no",
    });
    return next();
  }
  logger.info("WAHA webhook auth accepted", { callerIp: getCallerIp(req), path: req.path });
  return next();
};

const requireDarajaCallbackIp = (req, res, next) => {
  if (!env.security.enforceDarajaIpWhitelist) return next();
  const allowedIps = env.security.darajaAllowedIps || [];
  if (allowedIps.length === 0) {
    return res.status(500).json({ error: "Daraja IP whitelist enforcement misconfigured" });
  }
  const callerIp = getCallerIp(req);
  if (!ipAllowed(callerIp, allowedIps)) {
    logger.warn("Rejected Daraja callback IP", { callerIp, path: req.path });
    return res.status(403).json({ error: "Forbidden callback source" });
  }
  return next();
};

module.exports = {
  getCallerIp,
  logInboundWebhook,
  enforceHttpsAndCors,
  requireWahaWebhookAuth,
  requireDarajaCallbackIp,
};
