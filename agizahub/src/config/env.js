const dotenv = require("dotenv");

dotenv.config();

const requiredKeys = [
  "NODE_ENV",
  "PORT",
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_NUMBER",
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
  "MATCHING_COMMISSION_PERCENT",
  "LOGISTICS_PREMIUM_PERCENT",
  "DEFAULT_DELIVERY_FEE_KES",
  "TREASURY_SWEEP_THRESHOLD_KES",
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

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 10000),
  databaseUrl: process.env.DATABASE_URL,
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
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
  },
  businessRules: {
    matchingCommissionPercent: clamp(
      process.env.MATCHING_COMMISSION_PERCENT || "5",
      2,
      5
    ),
    logisticsPremiumPercent: Number(process.env.LOGISTICS_PREMIUM_PERCENT || "10"),
    premiumSupplierMonthlyFeeKes: Number(
      process.env.PREMIUM_SUPPLIER_MONTHLY_FEE_KES || "1500"
    ),
    defaultDeliveryFeeKes: Number(process.env.DEFAULT_DELIVERY_FEE_KES || "150"),
    treasurySweepThresholdKes: Number(
      process.env.TREASURY_SWEEP_THRESHOLD_KES || "50000"
    ),
  },
  admin: {
    whatsappPhone: process.env.ADMIN_WHATSAPP_PHONE || "",
  },
};
