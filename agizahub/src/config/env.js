const dotenv = require("dotenv");

dotenv.config();

const whatsappProvider = (process.env.WHATSAPP_GATEWAY_PROVIDER || "WAHA").toUpperCase();

const baseRequiredKeys = [
  "NODE_ENV",
  "PORT",
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "DARAJA_BASE_URL",
  "DARAJA_CONSUMER_KEY",
  "DARAJA_CONSUMER_SECRET",
  "DARAJA_SHORTCODE",
  "DARAJA_PASSKEY",
  "DARAJA_STK_CALLBACK_URL",
  "DARAJA_B2C_RESULT_URL",
  "DARAJA_B2C_TIMEOUT_URL",
  "DARAJA_B2B_RESULT_URL",
  "DARAJA_B2B_TIMEOUT_URL",
  "DARAJA_INITIATOR_NAME",
  "DARAJA_INITIATOR_PASSWORD",
  "LOGISTICS_PREMIUM_PERCENT",
  "TRANSPORT_BASE_FEE_KES",
  "TRANSPORT_BASE_DISTANCE_KM",
  "TRANSPORT_PER_KM_FEE_KES",
  "TRANSPORT_REQUESTER_COMMISSION_PERCENT",
  "TRANSPORTER_SIDE_COMMISSION_PERCENT",
  "TRANSPORTER_ASSIGNMENT_TIMEOUT_MINUTES",
  "DEFAULT_DELIVERY_FEE_KES",
  "TREASURY_SWEEP_THRESHOLD_KES",
];

const twilioRequiredKeys = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_NUMBER",
];

const wahaRequiredKeys = [
  "WHATSAPP_GATEWAY_API_KEY",
  "WAHA_BASE_URL",
  "WAHA_SESSION_NAME",
];

const requiredKeys = [
  ...baseRequiredKeys,
  ...(whatsappProvider === "WAHA" ? wahaRequiredKeys : twilioRequiredKeys),
];

const missingKeys = requiredKeys.filter((key) => !process.env[key]);
if (missingKeys.length > 0) {
  // eslint-disable-next-line no-console
  console.warn(
    `Missing environment variables: ${missingKeys.join(", ")}. ` +
      "The app may fail until these are configured."
  );
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
const parseBoolean = (value, fallback = false) => {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
};
const parseList = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const parseFeeRules = (rawValue, fallback) => {
  if (!rawValue) return fallback;
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return fallback;
    return parsed
      .map((rule) => ({
        min: Number(rule.min),
        max: Number(rule.max),
        fee: Number(rule.fee),
      }))
      .filter(
        (rule) =>
          Number.isFinite(rule.min) &&
          Number.isFinite(rule.max) &&
          Number.isFinite(rule.fee) &&
          rule.min >= 0 &&
          rule.max >= rule.min &&
          rule.fee >= 0
      );
  } catch (_error) {
    return fallback;
  }
};

const defaultB2CFeeRules = [
  { min: 1, max: 49, fee: 0 },
  { min: 50, max: 100, fee: 0 },
  { min: 101, max: 500, fee: 7 },
  { min: 501, max: 1000, fee: 13 },
  { min: 1001, max: 1500, fee: 23 },
  { min: 1501, max: 2500, fee: 33 },
  { min: 2501, max: 3500, fee: 53 },
  { min: 3501, max: 5000, fee: 57 },
  { min: 5001, max: 7500, fee: 78 },
  { min: 7501, max: 10000, fee: 90 },
  { min: 10001, max: 15000, fee: 100 },
  { min: 15001, max: 20000, fee: 105 },
  { min: 20001, max: 35000, fee: 108 },
  { min: 35001, max: 50000, fee: 108 },
  { min: 50001, max: 1000000, fee: 108 },
];

const defaultB2BFeeRules = [
  { min: 1, max: 1000, fee: 15 },
  { min: 1001, max: 5000, fee: 25 },
  { min: 5001, max: 10000, fee: 35 },
  { min: 10001, max: 20000, fee: 45 },
  { min: 20001, max: 50000, fee: 55 },
  { min: 50001, max: 1000000, fee: 65 },
];

const adminPhonesFromWhitelist = parseList(
  process.env.ADMIN_WHATSAPP_PHONES || process.env.ADMIN_WHATSAPP_PHONE
);
const adminPhonesFromSlots = [
  process.env.ADMIN_PHONE_1,
  process.env.ADMIN_PHONE_2,
  process.env.ADMIN_PHONE_3,
].filter(Boolean);
const resolvedAdminPhones = Array.from(new Set([...adminPhonesFromWhitelist, ...adminPhonesFromSlots]));

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 10000),
  databaseUrl: process.env.DATABASE_URL,
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  openAiBaseUrl: process.env.OPENAI_BASE_URL || process.env.BASE_URL || "",
  openRouter: {
    httpReferer: process.env.OPENROUTER_HTTP_REFERER || "",
    appName: process.env.OPENROUTER_APP_NAME || "AgizaHub AI",
  },
  whatsappGateway: {
    provider: whatsappProvider,
    apiKey: process.env.WHATSAPP_GATEWAY_API_KEY || "",
    wahaBaseUrl: process.env.WAHA_BASE_URL || "",
    wahaSessionName: process.env.WAHA_SESSION_NAME || "default",
    wahaSendPath: process.env.WAHA_SEND_PATH || "/api/sendText",
    wahaListPath: process.env.WAHA_LIST_PATH || "/api/sendList",
    wahaApiKeyHeader: process.env.WAHA_API_KEY_HEADER || "X-Api-Key",
    wahaSessionStatusPath: process.env.WAHA_SESSION_STATUS_PATH || "/api/sessions",
    wahaSessionStartPath:
      process.env.WAHA_SESSION_START_PATH || "/api/sessions/{session}/start",
    webhookSecret: process.env.WAHA_WEBHOOK_SECRET || "",
    botPhone: process.env.WAHA_BOT_PHONE || "",
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER,
  },
  daraja: {
    baseUrl: process.env.DARAJA_BASE_URL || "https://sandbox.safaricom.co.ke",
    consumerKey: process.env.DARAJA_CONSUMER_KEY,
    consumerSecret: process.env.DARAJA_CONSUMER_SECRET,
    shortcode: process.env.DARAJA_SHORTCODE,
    passkey: process.env.DARAJA_PASSKEY,
    stkCallbackUrl: process.env.DARAJA_STK_CALLBACK_URL,
    b2cResultUrl: process.env.DARAJA_B2C_RESULT_URL,
    b2cTimeoutUrl: process.env.DARAJA_B2C_TIMEOUT_URL,
    b2bResultUrl: process.env.DARAJA_B2B_RESULT_URL,
    b2bTimeoutUrl: process.env.DARAJA_B2B_TIMEOUT_URL,
    initiatorName: process.env.DARAJA_INITIATOR_NAME,
    initiatorPassword: process.env.DARAJA_INITIATOR_PASSWORD,
    b2cCommandId: process.env.DARAJA_B2C_COMMAND_ID || "BusinessPayment",
    b2bPaybillCommandId:
      process.env.DARAJA_B2B_PAYBILL_COMMAND_ID || "BusinessPayBill",
    b2bTillCommandId:
      process.env.DARAJA_B2B_TILL_COMMAND_ID || "BusinessBuyGoods",
    queueTimeoutUrl: process.env.DARAJA_QUEUE_TIMEOUT_URL,
    b2cFeeRules: parseFeeRules(
      process.env.DARAJA_B2C_FEE_RULES_JSON,
      defaultB2CFeeRules
    ),
    b2bFeeRules: parseFeeRules(
      process.env.DARAJA_B2B_FEE_RULES_JSON,
      defaultB2BFeeRules
    ),
  },
  businessRules: {
    matchingCommissionPercent: clamp(process.env.MATCHING_COMMISSION_PERCENT || "3", 2, 5),
    commissionTierThresholdKes: Number(process.env.COMMISSION_TIER_THRESHOLD_KES || "20000"),
    lowValueCommissionPercent: Number(process.env.LOW_VALUE_COMMISSION_PERCENT || "2"),
    highValueCommissionPercent: Number(process.env.HIGH_VALUE_COMMISSION_PERCENT || "5"),
    logisticsPremiumPercent: Number(process.env.LOGISTICS_PREMIUM_PERCENT || "10"),
    incomingGatewayFeePercent: Number(process.env.INCOMING_GATEWAY_FEE_PERCENT || "0.55"),
    incomingGatewayFeeCapKes: Number(process.env.INCOMING_GATEWAY_FEE_CAP_KES || "200"),
    incomingGatewayFeeFreeBelowKes: Number(
      process.env.INCOMING_GATEWAY_FEE_FREE_BELOW_KES || "200"
    ),
    outgoingPayoutFlatFeeKes: Number(process.env.OUTGOING_PAYOUT_FLAT_FEE_KES || "50"),
    transportBaseFeeKes: Number(process.env.TRANSPORT_BASE_FEE_KES || "1500"),
    transportBaseDistanceKm: Number(process.env.TRANSPORT_BASE_DISTANCE_KM || "10"),
    transportPerKmFeeKes: Number(process.env.TRANSPORT_PER_KM_FEE_KES || "40"),
    transportRequesterCommissionPercent: Number(
      process.env.TRANSPORT_REQUESTER_COMMISSION_PERCENT || "5"
    ),
    transporterSideCommissionPercent: Number(
      process.env.TRANSPORTER_SIDE_COMMISSION_PERCENT || "5"
    ),
    transporterAssignmentTimeoutMinutes: Number(
      process.env.TRANSPORTER_ASSIGNMENT_TIMEOUT_MINUTES || "20"
    ),
    defaultDeliveryFeeKes: Number(process.env.DEFAULT_DELIVERY_FEE_KES || "150"),
    treasurySweepThresholdKes: Number(
      process.env.TREASURY_SWEEP_THRESHOLD_KES || "50000"
    ),
  },
  admin: {
    whatsappPhone: process.env.ADMIN_WHATSAPP_PHONE || process.env.ADMIN_PHONE_1 || "",
    whatsappPhones: resolvedAdminPhones,
    name: process.env.ADMIN_NAME || "Admin",
    requireToken: parseBoolean(process.env.ADMIN_REQUIRE_TOKEN, true),
    tokenTtlMinutes: Number(process.env.ADMIN_TOKEN_TTL_MINUTES || "5"),
    sessionTtlMinutes: Number(process.env.ADMIN_SESSION_TTL_MINUTES || "120"),
    tokenMaxAttempts: Number(process.env.ADMIN_TOKEN_MAX_ATTEMPTS || "5"),
    alertChannel: process.env.ADMIN_ALERT_CHANNEL || "WHATSAPP",
    alertFallbackDestination:
      process.env.ADMIN_ALERT_FALLBACK_DESTINATION || "admin-dashboard",
  },
  security: {
    blockNonHttpsRequests: parseBoolean(process.env.BLOCK_NON_HTTPS_REQUESTS, true),
    corsAllowedOrigins: parseList(process.env.CORS_ALLOWED_ORIGINS),
    webhookLogPayloads: parseBoolean(process.env.WEBHOOK_LOG_PAYLOADS, false),
    enforceDarajaIpWhitelist: parseBoolean(process.env.DARAJA_ENFORCE_IP_WHITELIST, false),
    darajaAllowedIps: parseList(process.env.DARAJA_ALLOWED_IPS),
    maxOrderAmountKes: Number(process.env.MAX_ORDER_AMOUNT_KES || "200000"),
    maxDailyAmountKesPerBuyer: Number(process.env.MAX_DAILY_AMOUNT_KES_PER_BUYER || "500000"),
  },
  googleMaps: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY || "",
    distanceMatrixUrl:
      process.env.GOOGLE_MAPS_DISTANCE_MATRIX_URL ||
      "https://maps.googleapis.com/maps/api/distancematrix/json",
    cacheTtlHours: Number(process.env.DISTANCE_CACHE_TTL_HOURS || "168"),
    routePrecisionDp: Number(process.env.DISTANCE_CACHE_PRECISION_DP || "4"),
  },
};
