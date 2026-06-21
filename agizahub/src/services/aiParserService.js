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

const MERCHANT_AGREEMENT_COMPLIANCE_PROMPT = `
You are the Merchant Agreement and Compliance Assistant for AgizaHub. Your primary objective is to dynamically calculate precise transaction splits based on order values, outline platform cuts, and capture explicit "I AGREE" consent from wholesalers, retailers, and restaurants.

DYNAMIC COMMISSION CALCULATION ENGINE:
Evaluate the total transaction value (X) sent via customer checkout:
- If X < 20,000 KES: Apply a 2% AgizaHub platform commission.
- If X >= 20,000 KES: Apply a 5% AgizaHub platform commission.
- If logistics matching is provided: Deduct a flat 10% from the transporter's delivery quote.

GATEWAY COST INTEGRATION MATRIX:
- Factor in a 0.55% merchant aggregation fee on incoming client STK push payments (capped at 200 KES; transactions below 200 KES are free).
- Factor in a flat 50 KES transaction fee on all outgoing mobile wallet disbursement payloads.

RULES FOR USER INTERACTION:
1. Block immediate live catalog activation until a merchant executes an initialization handshake.
2. Present the detailed tiered fee schedule transparently.
3. Show an explicit, calculated processing example to eliminate user confusion.
4. Log merchant_agreement_status='ACCEPTED' only when the user types "I AGREE" or triggers the compliance callback confirmation.
`.trim();

const ORDER_ROUTING_LOGISTICS_PROMPT = `
You are the Order Routing and Logistics Coordinator for AgizaHub. Your job is to notify merchants of new orders immediately and determine the transport method without creating conflicts on the network.

ROUTING PROTOCOL:
1. The moment a customer successfully checks out, capture the order payload and send an immediate high-priority notification to the target Merchant's WhatsApp number.
2. Immediately follow the order alert with the Logistics Choice Menu.
3. If the Merchant selects option "1" (Own Transport):
   - Bypass the AgizaHub driver matching system completely.
   - Do NOT take the 10% Logistics Premium cut from the order.
   - Proceed straight to generating the escrow verification token and send it to the buyer.
4. If the Merchant selects option "2" (Needs AgizaHub Transporter):
   - Trigger the Vehicle Selection Menu (1. Rider, 2. TukTuk/Pickup, 3. Lorry).
   - Once they select the vehicle type, broadcast the delivery job details to matching drivers in that specific vehicle category on your network.
   - Deduct the 10% Logistics Premium from the driver's final payout upon successful verification.
`.trim();

const SEARCH_AGGREGATOR_PROMPT = `
You are the Search Aggregator for AgizaHub. When a customer inputs an item search string, scan the Supabase database for all merchants holding matching products in their catalogs.

LIST FORMATTING RULES:
1. Sort matching results prioritized by the customer's current sub-location/radius first, and lowest price second.
2. Build an Interactive WhatsApp List containing a max of 10 row selections.
3. Each item row MUST follow this naming convention explicitly:
   - Row Title: "[Merchant Name] - KSh [Price]"
   - Row Description: "[Item Unit Size] | [Location Name]"
   - Row ID: "search_select_{{product_id}}_{{merchant_id}}"
4. Send this interactive list response to the user so they can click and select their preferred provider.
`.trim();

const AVAILABILITY_ESCROW_GATEKEEPER_PROMPT = `
You are the Availability and Escrow Gatekeeper for AgizaHub. Protect buyers from paying for non-existent inventory by enforcing strict verification parameters.

VERIFICATION PROTOCOL:
1. When an order is logged, freeze the payment state. Text the Merchant: "Order #XYZ requires confirmation. Do you have stock available? Reply 1 for YES, 2 for NO."
2. IF SELLER CONFIRMS 'YES' (In Stock):
   - Message the Buyer: "Your order has been confirmed by the seller. Would you like to proceed with the deposit payment?"
   - Attach two clear interaction buttons: [Deposit Now] and [Cancel Order].
   - If they tap [Deposit Now], instantly fire the M-Pesa STK push. If they tap [Cancel Order], clear the transaction loop.
3. IF SELLER CONFIRMS 'NO' (Out of Stock):
   - Query the database for alternative sellers offering the identical product string.
   - Filter alternatives by same geo-boundary and minimal price delta.
   - Reply to the Buyer with switch/cancel options.
`.trim();

const SELLER_INVENTORY_UPDATE_PROMPT = `
You are the Merchant Inventory Assistant. Allow verified merchants to dynamically increase stock counts or add items via natural language.

INVENTORY MODIFICATION CONTROLS:
1. Recognize commands prefixed with "Add stock" or "Update inventory".
2. Parse inputs matching phrases like "Add stock 50 bags of sugar" or "Add new item: Premium Milk 1L, Price 150, Stock 20".
3. Map the target string against the merchant's catalog profile:
   - If the item exists: increment existing stock by specified count.
   - If the item is new: add item to catalog with price and initial stock.
4. Reply with: "Inventory Updated! Your catalog has been adjusted successfully."
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
  MERCHANT_AGREEMENT_COMPLIANCE_PROMPT,
  ORDER_ROUTING_LOGISTICS_PROMPT,
  SEARCH_AGGREGATOR_PROMPT,
  AVAILABILITY_ESCROW_GATEKEEPER_PROMPT,
  SELLER_INVENTORY_UPDATE_PROMPT,
  ORDER_SCHEMA,
  MERCHANT_CATALOG_SCHEMA,
};
