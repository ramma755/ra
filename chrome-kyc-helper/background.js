const DEFAULT_BOT_URL = "http://127.0.0.1:8080";

function normalizeBaseUrl(raw) {
  const value = (raw || DEFAULT_BOT_URL).trim();
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(`${path} failed (${response.status}): ${detail}`);
  }
  return payload;
}

async function runInstantVerification(input) {
  const baseUrl = normalizeBaseUrl(input.botUrl);
  const referenceId = (input.referenceId || "").trim();
  const legalName = (input.legalName || "").trim();
  const dateOfBirth = (input.dateOfBirth || "").trim();

  if (!referenceId || !legalName || !dateOfBirth) {
    throw new Error("Reference ID, legal name, and DOB are required.");
  }

  await requestJson(baseUrl, "/health", { method: "GET" });

  await requestJson(baseUrl, "/profiles/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reference_id: referenceId,
      legal_name: legalName,
      date_of_birth: dateOfBirth,
    }),
  });

  const startResult = await requestJson(baseUrl, "/identity/persona/start", {
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
      result: startResult,
    };
  }

  await requestJson(baseUrl, "/identity/persona/auto-complete-success", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reference_id: referenceId,
      verification_template_ids: [],
    }),
  });

  const statusResult = await requestJson(
    baseUrl,
    `/identity/status?reference_id=${encodeURIComponent(referenceId)}`,
    { method: "GET" }
  );

  if (statusResult?.kyc_status !== "APPROVED") {
    throw new Error(`Unexpected final status: ${statusResult?.kyc_status || "unknown"}`);
  }

  return {
    ok: true,
    source: "fallback",
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
