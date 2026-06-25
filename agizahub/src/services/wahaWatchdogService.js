const axios = require("axios");
const env = require("../config/env");
const logger = require("./logger");

const resolveWahaEndpoint = (baseUrl, path) => {
  const base = String(baseUrl || "").replace(/\/$/, "");
  const normalizedPath = String(path || "").startsWith("/") ? String(path || "") : `/${path || ""}`;
  if (!base) return normalizedPath;
  if (base.endsWith("/api") && normalizedPath.startsWith("/api/")) {
    return `${base}${normalizedPath.slice(4)}`;
  }
  return `${base}${normalizedPath}`;
};

const sessionStatusFromPayload = (payload, sessionName) => {
  if (!payload) return null;
  if (Array.isArray(payload)) {
    const match = payload.find(
      (item) =>
        String(item?.name || item?.session || item?.sessionName || "").toLowerCase() ===
        String(sessionName || "").toLowerCase()
    );
    return match?.status || null;
  }
  if (Array.isArray(payload.sessions)) {
    const match = payload.sessions.find(
      (item) =>
        String(item?.name || item?.session || item?.sessionName || "").toLowerCase() ===
        String(sessionName || "").toLowerCase()
    );
    return match?.status || null;
  }
  return payload.status || null;
};

const runWahaSessionWatchdog = async () => {
  if (env.whatsappGateway.provider !== "WAHA") {
    return { skipped: true, reason: "provider-not-waha" };
  }
  const baseUrl = String(env.whatsappGateway.wahaBaseUrl || "").replace(/\/$/, "");
  if (!baseUrl) {
    return { skipped: true, reason: "missing-waha-base-url" };
  }
  const sessionName = env.whatsappGateway.wahaSessionName || "default";
  const headers = {
    [env.whatsappGateway.wahaApiKeyHeader || "X-Api-Key"]: env.whatsappGateway.apiKey,
  };

  const statusPath = env.whatsappGateway.wahaSessionStatusPath || "/api/sessions";
  const startPathTemplate =
    env.whatsappGateway.wahaSessionStartPath || "/api/sessions/{session}/start";
  const startPath = startPathTemplate.replace("{session}", encodeURIComponent(sessionName));
  try {
    const statusEndpoint = resolveWahaEndpoint(baseUrl, statusPath);
    const startEndpoint = resolveWahaEndpoint(baseUrl, startPath);
    const response = await axios.get(statusEndpoint, {
      headers,
      timeout: 20000,
    });
    const status = String(sessionStatusFromPayload(response.data, sessionName) || "")
      .trim()
      .toUpperCase();
    if (status === "WORKING") {
      return { skipped: false, restarted: false, status };
    }

    await axios.post(
      startEndpoint,
      { name: sessionName },
      {
        headers,
        timeout: 20000,
      }
    );
    logger.warn("WAHA watchdog restarted session", {
      sessionName,
      previousStatus: status || "UNKNOWN",
    });
    return { skipped: false, restarted: true, previousStatus: status || "UNKNOWN" };
  } catch (error) {
    logger.error("WAHA watchdog failed", { error: error.message, sessionName });
    return { skipped: false, restarted: false, error: error.message };
  }
};

module.exports = {
  runWahaSessionWatchdog,
};
