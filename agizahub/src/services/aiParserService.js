const OpenAI = require("openai");
const env = require("../config/env");
const logger = require("./logger");

const client = new OpenAI({ apiKey: env.openAiApiKey });

const ORDER_SYSTEM_PROMPT = `
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

const ESCROW_ENGINE_SYSTEM_PROMPT = `
You are the Core Transaction Engine for AgizaHub. Your job is to strictly manage the transition of customer orders from payment to escrow holding, token generation, and secure disbursement execution.

RULES FOR ESCROW ENGINE:
1. When a payment callback is verified as successful, generate a secure, high-entropy 6-digit numeric validation token prefixed with "AGZ-" (e.g., AGZ-408129).
2. Save this token securely in the database under the specific order record, defaulting the state to 'HELD_IN_ESCROW'.
3. Output a clear, professional WhatsApp dispatch confirmation to the user containing the code, explicitly instructing them: "Do NOT share this code with your transporter until your goods arrive safely and match your expectations."
4. When a token validation request comes in (from a client confirming delivery), match the string. If valid, update the database status to 'RELEASED_TO_MERCHANT' and trigger the internal B2C disbursement payload function to release funds to the target phone number immediately. Reject any modified codes instantly.
`.trim();

const MERCHANT_CATALOG_SYSTEM_PROMPT = `
You are the Intelligent Merchant Onboarding Assistant for AgizaHub. Your primary capability is to intake unformatted text catalogs or menus sent by small business owners via WhatsApp and parse them into a standardized, clean database JSON layout.

Determine the exact Business Type classification based on these criteria:
- WHOLESALE: High bulk quantities, volume-tiered pricing, bulk distribution packages.
- RETAILER: Fixed consumer pricing, individual consumer units, small store inventory items.
- RESTAURANT: Food and beverage dishes, customizable modifiers (e.g., extra cheese, mild/spicy), preparation status items.
- GENERAL_SERVICES: Non-physical service bookings or arbitrary business types.

Strictly parse incoming catalog entries into the following JSON schema format:
{
  "merchant_phone": "{{sender_phone}}",
  "business_type": "[WHOLESALE / RETAILER / RESTAURANT / GENERAL_SERVICES]",
  "catalog_items": [
    {
      "name": "Exact item or dish title string",
      "category": "Department classification or course menu section",
      "price_per_unit_kes": 0,
      "minimum_order_qty": 1,
      "attributes": {
        "description": "Short marketing summary or details",
        "modifiers": ["applicable options array if restaurant or custom attributes"]
      }
    }
  ]
}

Respond ONLY with valid JSON strings when a merchant provides item lists. Do not append conversational text or Markdown code fences.
`.trim();

const MERCHANT_CATALOG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    merchant_phone: { type: "string" },
    business_type: {
      type: "string",
      enum: ["WHOLESALE", "RETAILER", "RESTAURANT", "GENERAL_SERVICES"],
    },
    catalog_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          category: { type: "string" },
          price_per_unit_kes: { type: "number" },
          minimum_order_qty: { type: "number" },
          attributes: {
            type: "object",
            additionalProperties: false,
            properties: {
              description: { type: "string" },
              modifiers: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["description", "modifiers"],
          },
        },
        required: [
          "name",
          "category",
          "price_per_unit_kes",
          "minimum_order_qty",
          "attributes",
        ],
      },
    },
  },
  required: ["merchant_phone", "business_type", "catalog_items"],
};

const normalizeBusinessType = (value) => {
  const upper = String(value || "")
    .trim()
    .toUpperCase();
  if (upper === "GENERAL") return "GENERAL_SERVICES";
  if (["WHOLESALE", "RETAILER", "RESTAURANT", "GENERAL_SERVICES"].includes(upper)) {
    return upper;
  }
  return "WHOLESALE";
};

const parseSimpleCatalogItems = (rawMessage) => {
  const lines = String(rawMessage || "")
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items = [];
  for (const line of lines) {
    const chunks = line.split(",");
    if (chunks.length < 2) continue;
    const name = chunks.slice(0, -1).join(",").trim();
    const price = Number(chunks[chunks.length - 1].replace(/[^\d.]/g, ""));
    if (!name || Number.isNaN(price) || price <= 0) continue;
    items.push({
      name,
      category: "General",
      price_per_unit_kes: price,
      minimum_order_qty: 1,
      attributes: {
        description: "",
        modifiers: [],
      },
    });
  }
  return items;
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
        { role: "system", content: ORDER_SYSTEM_PROMPT },
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

const parseMerchantCatalogMessage = async ({
  rawMessage,
  senderPhone,
  businessTypeHint,
}) => {
  const simpleItems = parseSimpleCatalogItems(rawMessage);
  if (simpleItems.length > 0) {
    return {
      merchant_phone: senderPhone,
      business_type: normalizeBusinessType(businessTypeHint),
      catalog_items: simpleItems,
      parse_source: "simple-fallback",
    };
  }

  try {
    const completion = await client.chat.completions.create({
      model: env.openAiModel,
      temperature: 0.1,
      messages: [
        { role: "system", content: MERCHANT_CATALOG_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            sender_phone: senderPhone,
            business_type_hint: normalizeBusinessType(businessTypeHint),
            raw_catalog_message: rawMessage,
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "agizahub_merchant_catalog",
          strict: true,
          schema: MERCHANT_CATALOG_SCHEMA,
        },
      },
    });

    const payload = JSON.parse(completion.choices[0].message.content);
    payload.business_type = normalizeBusinessType(payload.business_type);
    if (!Array.isArray(payload.catalog_items)) {
      payload.catalog_items = [];
    }
    return payload;
  } catch (error) {
    logger.warn("OpenAI merchant catalog parser failed", {
      message: error.message,
    });
    return {
      merchant_phone: senderPhone,
      business_type: normalizeBusinessType(businessTypeHint),
      catalog_items: [],
      parse_source: "ai-failed",
    };
  }
};

module.exports = {
  parseMarketplaceMessage,
  parseMerchantCatalogMessage,
  ORDER_SYSTEM_PROMPT,
  ESCROW_ENGINE_SYSTEM_PROMPT,
  MERCHANT_CATALOG_SYSTEM_PROMPT,
  ORDER_SCHEMA,
  MERCHANT_CATALOG_SCHEMA,
};
