const DEFAULT_BOT_URL = "http://127.0.0.1:8080";

function normalizeBaseUrl(raw) {
  const value = (raw || DEFAULT_BOT_URL).trim();
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isNetworkFetchError(error) {
  return error instanceof TypeError && error.message === "Failed to fetch";
}

function buildFallbackBaseUrls(primary) {
  const normalizedPrimary = normalizeBaseUrl(primary);
  const fallbacks = [normalizedPrimary];
  if (normalizedPrimary.includes("127.0.0.1")) {
    fallbacks.push(normalizedPrimary.replace("127.0.0.1", "localhost"));
  } else if (normalizedPrimary.includes("localhost")) {
    fallbacks.push(normalizedPrimary.replace("localhost", "127.0.0.1"));
  }
  return [...new Set(fallbacks)];
}

async function requestJson(baseUrl, path, options = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, options);
  } catch (error) {
    if (isNetworkFetchError(error)) {
      throw new Error(
        `Cannot reach local bot at ${baseUrl}. Keep uvicorn running and ensure Windows firewall allows local Python access.`
      );
    }
    throw error;
  }
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(`${path} failed (${response.status}): ${detail}`);
  }
  return payload;
}

async function runInstantVerification(input) {
  const candidateBaseUrls = buildFallbackBaseUrls(input.botUrl);
  const referenceId = (input.referenceId || "").trim();
  const legalName = (input.legalName || "").trim();
  const dateOfBirth = (input.dateOfBirth || "").trim();

  if (!referenceId || !legalName || !dateOfBirth) {
    throw new Error("Reference ID, legal name, and DOB are required.");
  }

  let lastError = null;
  let activeBaseUrl = null;
  for (const baseUrl of candidateBaseUrls) {
    try {
      await requestJson(baseUrl, "/health", { method: "GET" });
      activeBaseUrl = baseUrl;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!activeBaseUrl) {
    throw (
      lastError ||
      new Error("Unable to connect to local bot. Confirm uvicorn is running on port 8080.")
    );
  }

  await requestJson(activeBaseUrl, "/profiles/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reference_id: referenceId,
      legal_name: legalName,
      date_of_birth: dateOfBirth,
    }),
  });

  const startResult = await requestJson(activeBaseUrl, "/identity/persona/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reference_id: referenceId,
      skip_uploads: true,
    }),
  });

  if (startResult?.status === "APPROVED") {
    return {
      ok: true,
      source: "start",
      baseUrl: activeBaseUrl,
      result: startResult,
    };
  }

  await requestJson(activeBaseUrl, "/identity/persona/auto-complete-success", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reference_id: referenceId,
      verification_template_ids: [],
    }),
  });

  const statusResult = await requestJson(
    activeBaseUrl,
    `/identity/status?reference_id=${encodeURIComponent(referenceId)}`,
    { method: "GET" }
  );

  if (statusResult?.kyc_status !== "APPROVED") {
    throw new Error(`Unexpected final status: ${statusResult?.kyc_status || "unknown"}`);
  }

  return {
    ok: true,
    source: "fallback",
    baseUrl: activeBaseUrl,
    result: statusResult,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RUN_INSTANT_KYC_VERIFICATION") {
    return undefined;
  }

  runInstantVerification(message.payload || {})
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
