const OpenAI = require("openai");
const env = require("../config/env");
const logger = require("./logger");

const client = new OpenAI({ apiKey: env.openAiApiKey });

const SYSTEM_PROMPT = `
You are AgizaHub AI, a Kenyan marketplace order parser.
Input may be in Sheng, Swahili, English, mixed slang, short forms, and typos.
Extract best-effort structured order intent with high precision.
If a field is unknown, return null (do not hallucinate).
`.trim();

const ORDER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ["order_request", "unknown"] },
    product: { type: ["string", "null"] },
    quantity: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    budgetKes: { type: ["number", "null"] },
    deliveryLocation: { type: ["string", "null"] },
    preferredVendor: { type: ["string", "null"] },
    requestedTime: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
  },
  required: [
    "intent",
    "product",
    "quantity",
    "unit",
    "budgetKes",
    "deliveryLocation",
    "preferredVendor",
    "requestedTime",
    "notes",
  ],
};

const fallbackParse = (rawMessage) => {
  const lower = rawMessage.toLowerCase();
  const qtyMatch = lower.match(/(\d+(?:\.\d+)?)/);
  const locationMatch =
    rawMessage.match(/(?:to|kwa|deliver(?: to)?|peleka)\s+([a-zA-Z0-9\s-]+)/i) ||
    rawMessage.match(/(?:in|at)\s+([a-zA-Z0-9\s-]+)/i);

  return {
    intent: "order_request",
    product: rawMessage.split(" ").slice(0, 3).join(" "),
    quantity: qtyMatch ? Number(qtyMatch[1]) : null,
    unit: null,
    budgetKes: null,
    deliveryLocation: locationMatch ? locationMatch[1].trim() : null,
    preferredVendor: null,
    requestedTime: null,
    notes: "fallback-parser",
  };
};

const parseMarketplaceMessage = async (rawMessage) => {
  if (!rawMessage || !rawMessage.trim()) {
    return {
      intent: "unknown",
      product: null,
      quantity: null,
      unit: null,
      budgetKes: null,
      deliveryLocation: null,
      preferredVendor: null,
      requestedTime: null,
      notes: "empty-message",
    };
  }

  try {
    const completion = await client.chat.completions.create({
      model: env.openAiModel,
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: rawMessage },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "agizahub_order_intent",
          strict: true,
          schema: ORDER_SCHEMA,
        },
      },
    });

    const payload = JSON.parse(completion.choices[0].message.content);
    return payload;
  } catch (error) {
    logger.warn("OpenAI parser failed, using fallback parser", {
      message: error.message,
    });
    return fallbackParse(rawMessage);
  }
};

module.exports = {
  parseMarketplaceMessage,
  SYSTEM_PROMPT,
  ORDER_SCHEMA,
};
