const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { query, transaction } = require("../config/db");
const env = require("../config/env");
const {
  parseMarketplaceMessage,
  parseMerchantCatalogMessage,
} = require("../services/aiParserService");
const { initiateStkPush, normalizeMsisdn } = require("../services/darajaService");
const {
  roleFromChoice,
  paymentModeFromChoice,
  formatPublicMaskedId,
  ensureUserRecord,
} = require("../services/platformUserService");
const {
  parseInboundWhatsappPayload,
  sendGatewayReply,
} = require("../services/whatsappGatewayService");
const {
  verifyOtpAndQueueRelease,
  releaseOrderByAdmin,
  holdOrderByAdmin,
  requestOrderRefund,
  approveRefundByAdmin,
  rejectRefundByAdmin,
} = require("../services/settlementService");
const {
  computeTransportBreakdown,
  resolveRouteDistance,
  haversineDistanceKm,
} = require("../services/logisticsPricingService");
const {
  resolveTieredCommissionPercent,
  computeIncomingGatewayFeeKes,
} = require("../services/pricingPolicyService");
const {
  enqueueTransportJobBroadcasts,
  listQueuedJobsForDriver,
  claimBroadcastJob,
} = require("../services/transportBroadcastService");
const logger = require("../services/logger");

const twimlResponse = (message) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;

const respondToUser = async ({
  res,
  provider,
  senderPhone,
  message,
  interactiveList = null,
}) => {
  if (provider === "WAHA") {
    await sendGatewayReply({
      provider,
      toPhone: senderPhone,
      message,
      interactiveList,
    });
    return res.status(200).json({ ok: true, provider });
  }
  return res.type("text/xml").send(twimlResponse(message));
};

const acknowledgeWebhook = ({ res, provider }) => {
  if (provider === "WAHA") {
    return res.status(200).json({ ok: true, provider });
  }
  return res
    .type("text/xml")
    .send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
};

const onboardingMenu = () =>
  [
    "Jambo! Welcome to AgizaHub. I see you are new here.",
    "How would you like to use our platform today?",
    "",
    "Reply with:",
    "1 - Register as a Buyer",
    "2 - Register as a Supplier / Wholesaler",
    "3 - Register as a Transporter (Short distance / Motorbike)",
    "4 - Register as a Transporter (Long distance / Truck)",
  ].join("\n");

const paymentModeMenu = () =>
  [
    "How should AgizaHub process payments or refunds to your account?",
    "Reply with:",
    "1 - Send Money (M-Pesa to your phone)",
    "2 - Buy Goods Till Number",
    "3 - Business Paybill",
  ].join("\n");

const supplierBusinessTypeMenu = () =>
  [
    "Select your business catalog type:",
    "1 - WHOLESALE",
    "2 - RETAILER",
    "3 - RESTAURANT",
    "4 - GENERAL_SERVICES",
  ].join("\n");

const sellerLogisticsChoiceMenu = () =>
  [
    "LOGISTICS SELECTION",
    "How will this order be delivered to the customer?",
    "",
    "Reply with 1 or 2:",
    "1 - I am using my own business transport/delivery means.",
    "2 - I need AgizaHub to match me with an on-demand transporter.",
  ].join("\n");

const sellerVehicleSelectionMenu = () =>
  [
    "SELECT VEHICLE TYPE",
    "What type of vehicle do you need for this delivery?",
    "",
    "Reply with 1, 2, 3, or 4:",
    "1 - Rider / Motorbike (small packages)",
    "2 - TukTuk (medium store supplies)",
    "3 - Pickup Truck (bulk goods up to 1 ton)",
    "4 - Lorry / Truck (heavy commercial distribution)",
  ].join("\n");

const sellerStockConfirmationMenu = ({ orderId }) =>
  [
    `Order #${String(orderId || "").slice(0, 8)} requires stock confirmation.`,
    "Reply:",
    "1 - In stock",
    "2 - Out of stock",
  ].join("\n");

const buyerDepositDecisionMenu = ({ orderId, totalAmountKes }) =>
  [
    "PAYMENT AUTHORIZATION",
    `Order #${String(orderId || "").slice(0, 8)} has been confirmed by seller.`,
    `Total Due: KSh ${Number(totalAmountKes || 0).toLocaleString()}`,
    "Status: Awaiting Escrow Deposit",
    "",
    "Reply:",
    "1 - Deposit Now (trigger M-Pesa STK prompt)",
    "2 - Cancel Order",
  ].join("\n");

const merchantAgreementMessage = () => {
  const lowPercent = Number(env.businessRules.lowValueCommissionPercent || 2);
  const highPercent = Number(env.businessRules.highValueCommissionPercent || 5);
  const threshold = Number(env.businessRules.commissionTierThresholdKes || 20000);
  const incomingFeePercent = Number(env.businessRules.incomingGatewayFeePercent || 0.55);
  const incomingFeeCapKes = Number(env.businessRules.incomingGatewayFeeCapKes || 200);
  const outgoingFeeKes = Number(env.businessRules.outgoingPayoutFlatFeeKes || 50);
  const logisticsPercent = Number(env.businessRules.logisticsPremiumPercent || 10);

  const smallOrder = 10000;
  const smallPlatform = Number(((smallOrder * lowPercent) / 100).toFixed(2));
  const smallGateway = computeIncomingGatewayFeeKes(smallOrder);
  const smallSettle = Number(
    (smallOrder - smallPlatform - smallGateway - outgoingFeeKes).toFixed(2)
  );

  const bigOrder = 30000;
  const bigPlatform = Number(((bigOrder * highPercent) / 100).toFixed(2));
  const bigGateway = computeIncomingGatewayFeeKes(bigOrder);
  const bigSettle = Number(
    (bigOrder - bigPlatform - bigGateway - outgoingFeeKes).toFixed(2)
  );

  return [
    "AGIZAHUB SYSTEM TERMS & COMMISSION AGREEMENT",
    "",
    "Performance-based pricing (no monthly subscription):",
    `- Orders below KSh ${threshold.toLocaleString()}: ${lowPercent}% platform commission`,
    `- Orders KSh ${threshold.toLocaleString()} and above: ${highPercent}% platform commission`,
    `- Incoming STK processing fee: ${incomingFeePercent}% (cap KSh ${incomingFeeCapKes}; free below KSh ${Number(
      env.businessRules.incomingGatewayFeeFreeBelowKes || 200
    ).toLocaleString()})`,
    `- Outgoing payout network fee: KSh ${outgoingFeeKes} per disbursement leg`,
    `- Matched transport cut: ${logisticsPercent}% from transporter quote`,
    "",
    "Example calculations:",
    `- KSh ${smallOrder.toLocaleString()} order -> settle KSh ${smallSettle.toLocaleString()} (after ${lowPercent}% + gateway + payout fee)`,
    `- KSh ${bigOrder.toLocaleString()} order -> settle KSh ${bigSettle.toLocaleString()} (after ${highPercent}% + gateway cap + payout fee)`,
    "",
    "Funds remain in escrow until delivery code verification + admin release.",
    "Reply exactly: I AGREE",
  ].join("\n");
};

const transportCategoryMenu = () =>
  [
    "Need to move goods? Let's find you a secure transporter.",
    "",
    "Reply with:",
    "1 - Commercial Freight (business stock/wholesale goods)",
    "2 - Personal Relocation (house moves, electronics, personal items)",
  ].join("\n");

const transportVehicleMenu = () =>
  [
    "What size vehicle do you require?",
    "",
    "1 - Motorbike (small packages)",
    "2 - Tuk-tuk / Pickup (small house move / 1 tonne max)",
    "3 - Canter / Truck (bulk load / 3+ tonnes)",
  ].join("\n");

const parseCoordinates = (input) => {
  const parts = String(input || "").split(",");
  if (parts.length < 2) return null;
  const latitude = Number(parts[0].trim());
  const longitude = Number(parts[1].trim());
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
  };
};

const normalizeOrderIdFromText = (text) => (text || "").trim();

const parseCatalogLine = (rawMessage) => {
  const chunks = rawMessage.split(",");
  if (chunks.length < 2) return null;
  const commodity = chunks[0].trim();
  const price = Number(chunks[1].replace(/[^\d.]/g, "").trim());
  if (!commodity || Number.isNaN(price) || price <= 0) return null;
  const stockChunk = chunks[2] ? Number(chunks[2].replace(/[^\d]/g, "").trim()) : null;
  const stockQuantity = Number.isFinite(stockChunk) && stockChunk >= 0 ? stockChunk : null;
  return { commodity, price, stockQuantity };
};

const parseAddStockCommand = (rawMessage) => {
  const match = String(rawMessage || "")
    .trim()
    .match(/^add\s+stock\s+(\d+)\s+(.+)$/i);
  if (!match) return null;
  return {
    quantity: Number(match[1]),
    commodity: match[2].trim().slice(0, 50),
  };
};

const parseInventoryNewItemCommand = (rawMessage) => {
  const cleaned = String(rawMessage || "")
    .trim()
    .replace(/^add\s+new\s+item\s*:\s*/i, "")
    .replace(/^update\s+inventory\s*:\s*/i, "")
    .replace(/^update\s+inventory\s+/i, "");
  if (!cleaned) return null;

  const chunks = cleaned.split(",").map((c) => c.trim()).filter(Boolean);
  const name = (chunks[0] || "").replace(/^item\s*:\s*/i, "").trim();
  if (!name) return null;

  const priceMatch =
    cleaned.match(/price\s*[:=]?\s*(\d+(?:\.\d+)?)/i) ||
    cleaned.match(/ksh\s*(\d+(?:\.\d+)?)/i);
  const stockMatch = cleaned.match(/stock\s*[:=]?\s*(\d+)/i);
  const fallbackPrice =
    chunks.length > 1 ? Number(chunks[1].replace(/[^\d.]/g, "")) : Number.NaN;

  const price = priceMatch ? Number(priceMatch[1]) : fallbackPrice;
  if (!Number.isFinite(price) || price <= 0) return null;

  const stock = stockMatch ? Number(stockMatch[1]) : 0;

  return {
    commodity: name.slice(0, 50),
    price,
    stockQuantity: Number.isFinite(stock) && stock >= 0 ? stock : 0,
  };
};

const parseSupplierBusinessTypeChoice = (choice) => {
  if (choice === "1") return "WHOLESALE";
  if (choice === "2") return "RETAILER";
  if (choice === "3") return "RESTAURANT";
  if (choice === "4") return "GENERAL_SERVICES";
  return null;
};

const normalizeSupplierBusinessType = (value) => {
  const upper = String(value || "")
    .trim()
    .toUpperCase();
  if (upper === "GENERAL") return "GENERAL_SERVICES";
  if (["WHOLESALE", "RETAILER", "RESTAURANT", "GENERAL_SERVICES"].includes(upper)) {
    return upper;
  }
  return "WHOLESALE";
};

const maskBuyerPhone = (phone) => {
  const msisdn = normalizeMsisdn(phone || "");
  if (msisdn.length < 6) return msisdn;
  return `${msisdn.slice(0, msisdn.length - 2)}XX`;
};

const generateEscrowToken = async () => {
  const otp = `AGZ-${crypto.randomInt(0, 1000000).toString().padStart(6, "0")}`;
  const otpHash = await bcrypt.hash(otp, 10);
  return { otp, otpHash };
};

const parseAndNormalizeMerchantCatalog = async ({
  rawMessage,
  merchantPhone,
  businessTypeHint,
}) => {
  const cleanedInput = String(rawMessage || "").replace(/^catalog\s+/i, "").trim();
  const simple = parseCatalogLine(cleanedInput);
  if (simple) {
    return {
      businessType: normalizeSupplierBusinessType(businessTypeHint),
      items: [
        {
          commodity: simple.commodity.slice(0, 50),
          pricePerUnitKes: Math.round(simple.price),
          stockQuantity:
            simple.stockQuantity == null ? 100 : Number(simple.stockQuantity),
          metadata: {
            source: "simple-line",
            category: "General",
            minimum_order_qty: 1,
            attributes: {
              description: "",
              modifiers: [],
            },
          },
        },
      ],
    };
  }

  const parsed = await parseMerchantCatalogMessage({
    rawMessage: cleanedInput,
    senderPhone: merchantPhone,
    businessTypeHint,
  });

  const items = Array.isArray(parsed.catalog_items)
    ? parsed.catalog_items
        .map((item) => {
          const price = Number(item.price_per_unit_kes);
          const name = String(item.name || "").trim();
          if (!name || !Number.isFinite(price) || price <= 0) return null;
          return {
            commodity: name.slice(0, 50),
            pricePerUnitKes: Math.round(price),
            stockQuantity: 100,
            metadata: {
              source: "ai-catalog-parser",
              category: String(item.category || "General").slice(0, 80),
              minimum_order_qty: Number(item.minimum_order_qty || 1),
              attributes: {
                description: String(item.attributes?.description || "").slice(0, 240),
                modifiers: Array.isArray(item.attributes?.modifiers)
                  ? item.attributes.modifiers.slice(0, 20)
                  : [],
              },
            },
          };
        })
        .filter(Boolean)
    : [];

  return {
    businessType: normalizeSupplierBusinessType(parsed.business_type || businessTypeHint),
    items,
  };
};

const parseTransportCategory = (choice) => {
  if (choice === "1") return "COMMERCIAL_FREIGHT";
  if (choice === "2") return "PERSONAL_RELOCATION";
  return null;
};

const parseVehicleType = (choice) => {
  if (choice === "1") return "MOTORBIKE";
  if (choice === "2") return "TUKTUK_PICKUP";
  if (choice === "3") return "CANTER_TRUCK";
  return null;
};

const parseSellerVehicleChoice = (choice) => {
  if (choice === "1") return { vehicleType: "MOTORBIKE", label: "Rider / Motorbike" };
  if (choice === "2") return { vehicleType: "TUKTUK_PICKUP", label: "TukTuk" };
  if (choice === "3") return { vehicleType: "TUKTUK_PICKUP", label: "Pickup Truck" };
  if (choice === "4") return { vehicleType: "CANTER_TRUCK", label: "Lorry / Truck" };
  return null;
};

const defaultTransporterVehicleType = (userType) => {
  if (userType === "TRANSPORTER_BIKE") return "MOTORBIKE";
  if (userType === "TRANSPORTER_TRUCK") return "CANTER_TRUCK";
  return null;
};

const resolveUserByMaskedId = async (client, maskedId) => {
  const result = await client.query(
    `SELECT * FROM platform_users WHERE masked_id = $1 LIMIT 1`,
    [maskedId]
  );
  return result.rows[0] || null;
};

const resolveProduct = async (client, parsedProduct) => {
  if (!parsedProduct) return null;
  const direct = await client.query(
    `
      SELECT p.*
      FROM products p
      WHERE LOWER(p.name) = LOWER($1)
      LIMIT 1
    `,
    [parsedProduct]
  );
  if (direct.rowCount > 0) return direct.rows[0];

  const slang = await client.query(
    `
      SELECT p.*
      FROM product_slang s
      JOIN products p ON p.id = s.product_id
      WHERE LOWER(s.phrase) = LOWER($1)
      LIMIT 1
    `,
    [parsedProduct]
  );
  return slang.rows[0] || null;
};

const resolveVendorInventory = async (client, productId, preferredVendor) =>
  client.query(
    `
      SELECT
        vi.*,
        v.name AS vendor_name
      FROM vendor_inventory vi
      JOIN vendors v ON v.id = vi.vendor_id
      WHERE vi.product_id = $1
        AND vi.is_active = TRUE
        AND (
          $2::text IS NULL
          OR LOWER(v.name) LIKE CONCAT('%', LOWER($2), '%')
        )
      ORDER BY vi.price_kes ASC
      LIMIT 1
    `,
    [productId, preferredVendor || null]
  );

const resolveTransporter = async (client) =>
  client.query(
    `
      SELECT id, name, phone
      FROM transporters
      WHERE is_active = TRUE
      ORDER BY created_at ASC
      LIMIT 1
    `
  );

const resolvePlatformTransporter = async (client) =>
  client.query(
    `
      SELECT masked_id, company_name
      FROM platform_users
      WHERE user_type IN ('TRANSPORTER_BIKE', 'TRANSPORTER_TRUCK')
        AND current_step = 'COMPLETED'
      ORDER BY created_at ASC
      LIMIT 1
    `
  );

const listCatalogOffersMessage = async () => {
  const result = await query(
    `
      SELECT
        c.id AS catalog_item_id,
        c.commodity_name,
        c.price_per_unit,
        c.unit_measure,
        c.location_label,
        c.business_type,
        c.stock_quantity,
        u.masked_id,
        u.company_name,
        u.hub_latitude,
        u.hub_longitude
      FROM catalog_items c
      JOIN platform_users u ON u.masked_id = c.seller_masked_id
      WHERE c.is_active = TRUE
        AND c.stock_quantity > 0
        AND u.user_type = 'SUPPLIER'
        AND COALESCE(u.merchant_agreement_status, 'PENDING') = 'ACCEPTED'
      ORDER BY c.price_per_unit ASC, c.created_at ASC
      LIMIT 15
    `
  );

  if (result.rowCount === 0) {
    return "Hakuna offers kwa sasa. Suppliers wanapakia stock hivi karibuni.";
  }

  const lines = ["Available Offers Today:"];
  for (const item of result.rows) {
    lines.push(
      "",
      `${item.commodity_name}`,
      `Seller: ${item.company_name || `Supplier #${item.masked_id}`} (ID: #${item.masked_id})`,
      `Business Type: ${item.business_type || "WHOLESALE"}`,
      `Price: KSh ${Number(item.price_per_unit).toLocaleString()} per ${item.unit_measure}`,
      `Stock: ${Number(item.stock_quantity || 0).toLocaleString()}`,
      `Location: ${item.location_label}`,
      `To purchase: Buy ${item.masked_id} 10`,
      `Or search row: search_select_${item.catalog_item_id}_${item.masked_id}`
    );
  }
  return lines.join("\n");
};

const searchCatalogRows = async ({ searchTerm, excludeSellerMaskedId = null }) => {
  return query(
    `
      SELECT
        c.id AS catalog_item_id,
        c.seller_masked_id,
        c.commodity_name,
        c.price_per_unit,
        c.unit_measure,
        c.location_label,
        c.business_type,
        c.stock_quantity,
        u.company_name,
        u.hub_latitude,
        u.hub_longitude
      FROM catalog_items c
      JOIN platform_users u ON u.masked_id = c.seller_masked_id
      WHERE c.is_active = TRUE
        AND c.stock_quantity > 0
        AND COALESCE(u.merchant_agreement_status, 'PENDING') = 'ACCEPTED'
        AND u.user_type = 'SUPPLIER'
        AND (
          LOWER(c.commodity_name) LIKE CONCAT('%', LOWER($1), '%')
          OR LOWER(COALESCE(c.location_label, '')) LIKE CONCAT('%', LOWER($1), '%')
        )
        AND ($2::text IS NULL OR c.seller_masked_id <> $2)
      ORDER BY c.price_per_unit ASC, c.created_at ASC
      LIMIT 50
    `,
    [searchTerm, excludeSellerMaskedId]
  );
};

const rankSearchRowsForBuyer = ({ rows, buyer }) => {
  const buyerHasCoords =
    buyer && buyer.delivery_latitude != null && buyer.delivery_longitude != null;
  return [...rows]
    .map((row) => {
      const distanceKm =
        buyerHasCoords && row.hub_latitude != null && row.hub_longitude != null
          ? haversineDistanceKm({
              fromLat: buyer.delivery_latitude,
              fromLng: buyer.delivery_longitude,
              toLat: row.hub_latitude,
              toLng: row.hub_longitude,
            })
          : null;
      return {
        ...row,
        distanceKm,
      };
    })
    .sort((a, b) => {
      const da = a.distanceKm == null ? Number.MAX_SAFE_INTEGER : Number(a.distanceKm);
      const db = b.distanceKm == null ? Number.MAX_SAFE_INTEGER : Number(b.distanceKm);
      if (da !== db) return da - db;
      return Number(a.price_per_unit) - Number(b.price_per_unit);
    });
};

const buildSearchInteractiveList = ({ searchTerm, rankedRows }) => {
  const rows = rankedRows.slice(0, 10).map((row) => ({
    id: `search_select_${row.catalog_item_id}_${row.seller_masked_id}`,
    title: `${row.company_name || `Seller #${row.seller_masked_id}`} - KSh ${Number(
      row.price_per_unit
    ).toLocaleString()}`,
    description: `${row.unit_measure || "unit"} | ${row.location_label || "Location"}`,
  }));

  return {
    title: "Product Search Results",
    body: `Found ${rankedRows.length} seller option(s) for "${searchTerm}".`,
    buttonText: "Choose Seller",
    sections: [
      {
        title: "Available Sellers",
        rows,
      },
    ],
  };
};

const buildSearchTextList = ({ searchTerm, rankedRows }) => {
  const lines = [`Search results for "${searchTerm}" (choose one):`];
  rankedRows.slice(0, 10).forEach((row, idx) => {
    lines.push(
      "",
      `${idx + 1}. ${row.company_name || `Seller #${row.seller_masked_id}`} - KSh ${Number(
        row.price_per_unit
      ).toLocaleString()}`,
      `${row.unit_measure || "unit"} | ${row.location_label || "Location"}`,
      `ID: search_select_${row.catalog_item_id}_${row.seller_masked_id}`
    );
  });
  lines.push("", "Reply with the row ID above to continue.");
  return lines.join("\n");
};

const parseSearchSelectionId = (rawMessage) => {
  const match = String(rawMessage || "")
    .trim()
    .match(/^search_select_(\d+)_([0-9]{5})$/i);
  if (!match) return null;
  return {
    catalogItemId: Number(match[1]),
    sellerMaskedId: match[2],
  };
};

const buildSearchQuantityPrompt = ({ row }) =>
  [
    `Selected: ${row.commodity_name} from ${row.company_name || `Seller #${row.seller_masked_id}`}`,
    `Price: KSh ${Number(row.price_per_unit).toLocaleString()} per ${row.unit_measure || "unit"}`,
    `Location: ${row.location_label || "N/A"}`,
    `In stock: ${Number(row.stock_quantity || 0).toLocaleString()}`,
    "",
    "Reply with quantity number to continue (or 0 to cancel).",
  ].join("\n");

const isAdminPhone = (communicationPhone, senderPhone) => {
  const configured = (env.admin.whatsappPhone || "").trim();
  if (!configured) return false;
  if (configured === communicationPhone) return true;
  const configuredDigits = normalizeMsisdn(configured.replace("whatsapp:+", ""));
  return configuredDigits && configuredDigits === senderPhone;
};

const handleAdminCommand = async (rawMessage, senderPhone) => {
  const releaseMatch = rawMessage.match(/^release\s+([a-zA-Z0-9-]+)/i);
  if (releaseMatch) {
    const orderId = normalizeOrderIdFromText(releaseMatch[1]);
    await releaseOrderByAdmin({ orderId, actorPhone: senderPhone });
    return `Order #${orderId} released. Payouts submitted.`;
  }

  const holdMatch = rawMessage.match(/^hold\s+([a-zA-Z0-9-]+)(?:\s+(.+))?/i);
  if (holdMatch) {
    const orderId = normalizeOrderIdFromText(holdMatch[1]);
    await holdOrderByAdmin({
      orderId,
      actorPhone: senderPhone,
      note: holdMatch[2] || null,
    });
    return `Order #${orderId} is now ON_HOLD for investigation.`;
  }

  const approveMatch = rawMessage.match(/^approve\s+([a-zA-Z0-9-]+)/i);
  if (approveMatch) {
    const orderId = normalizeOrderIdFromText(approveMatch[1]);
    await approveRefundByAdmin({ orderId, actorPhone: senderPhone });
    return `Refund approved for order #${orderId}. Buyer refund submitted.`;
  }

  const rejectMatch = rawMessage.match(/^reject\s+([a-zA-Z0-9-]+)/i);
  if (rejectMatch) {
    const orderId = normalizeOrderIdFromText(rejectMatch[1]);
    await rejectRefundByAdmin({ orderId, actorPhone: senderPhone });
    await releaseOrderByAdmin({ orderId, actorPhone: senderPhone });
    return `Refund rejected for #${orderId}. Standard payouts released.`;
  }

  return null;
};

const formatCheckoutSummary = ({
  quantity,
  commodityName,
  unitMeasure,
  unitPrice,
  itemSubtotal,
  supplierHubLabel,
  buyerDestinationLabel,
  routeLabel,
  transport,
  totalAmount,
}) =>
  [
    "AGIZAHUB ORDER SUMMARY",
    "--------------------------",
    `Items: ${quantity} ${unitMeasure} of ${commodityName} @ KSh ${Number(
      unitPrice
    ).toLocaleString()} = KSh ${Number(itemSubtotal).toLocaleString()}`,
    `Supplier Hub: ${supplierHubLabel}`,
    `Delivery Destination: ${buyerDestinationLabel}`,
    `Route: ${routeLabel}`,
    `Transport Fee (${transport.distanceKm} KM): KSh ${Number(
      transport.totalTransportFeeKes
    ).toLocaleString()}`,
    `Distance provider: ${transport.distanceProvider}`,
    "--------------------------",
    `TOTAL AMOUNT TO PAY: KSh ${Number(totalAmount).toLocaleString()}`,
    "Reply 1 to confirm. M-Pesa prompt will appear instantly.",
  ].join("\n");

const formatTransportOnlySummary = ({
  category,
  pickupLabel,
  dropoffLabel,
  vehicleType,
  transport,
  requesterCommissionPercent,
  requesterCommissionKes,
  incomingGatewayFeeKes,
  requesterTotalKes,
  transporterCommissionPercent,
  broadcastedDrivers,
  corridorKey,
}) =>
  [
    "AGIZAHUB TRANSPORT SUMMARY",
    "--------------------------",
    `Category: ${category === "COMMERCIAL_FREIGHT" ? "Commercial Freight" : "Personal Relocation"}`,
    `Pickup: ${pickupLabel}`,
    `Drop-off: ${dropoffLabel}`,
    `Vehicle: ${vehicleType}`,
    `Route: ${pickupLabel} -> ${dropoffLabel}`,
    `Distance: ${transport.distanceKm} KM (${transport.distanceProvider})`,
    `Raw Transit Fare: KSh ${Number(transport.rawTransportFeeKes).toLocaleString()}`,
    `Your Requester Fee (${requesterCommissionPercent}%): KSh ${Number(
      requesterCommissionKes
    ).toLocaleString()}`,
    `Gateway Fee (settlement-side): KSh ${Number(incomingGatewayFeeKes || 0).toLocaleString()}`,
    `Transporter commission at release: ${transporterCommissionPercent}% (auto-deducted from driver payout)`,
    `Targeted drivers pinged: ${broadcastedDrivers} (corridor ${corridorKey})`,
    `TOTAL TO PAY NOW: KSh ${Number(requesterTotalKes).toLocaleString()}`,
    "--------------------------",
    "Reply 1 to confirm and trigger STK push.",
  ].join("\n");

const formatSellerOrderAlert = ({ payload }) =>
  [
    "NEW ORDER RECEIVED!",
    "",
    `Order ID: #${payload.order.id.slice(0, 8)}`,
    `Customer Phone: ${maskBuyerPhone(payload.order.buyer_phone)}`,
    "",
    "Items Ordered:",
    `${payload.quantity || 0}x ${payload.catalogItem.commodity_name} (KSh ${Number(payload.itemSubtotal).toLocaleString()})`,
    "",
    `Total Value: KSh ${Number(payload.order.total_amount_kes).toLocaleString()} (Escrow pending payment)`,
  ].join("\n");

const safeNotifyWhatsappPhone = async ({ toPhone, message, interactiveList = null }) => {
  if (env.whatsappGateway.provider !== "WAHA") {
    return false;
  }
  if (!toPhone || !message) return false;
  try {
    await sendGatewayReply({
      provider: "WAHA",
      toPhone,
      message,
      interactiveList,
    });
    return true;
  } catch (error) {
    logger.warn("Failed proactive WAHA message", {
      toPhone,
      message: error.message,
    });
    return false;
  }
};

const notifySellerForLogisticsDecision = async ({ payload }) => {
  const sellerPhone = payload?.seller?.phone_number || "";
  if (!sellerPhone) return;
  await safeNotifyWhatsappPhone({
    toPhone: sellerPhone,
    message: formatSellerOrderAlert({ payload }),
  });
  await safeNotifyWhatsappPhone({
    toPhone: sellerPhone,
    message: sellerStockConfirmationMenu({ orderId: payload?.order?.id }),
  });
};

const notifyBuyerCheckoutReady = async ({ order, modeLabel }) => {
  if (!order?.buyer_phone) return;
  await safeNotifyWhatsappPhone({
    toPhone: order.buyer_phone,
    message: [
      `Order #${order.id.slice(0, 8)} logistics confirmed: ${modeLabel}`,
      buyerDepositDecisionMenu({
        orderId: order.id,
        totalAmountKes: order.total_amount_kes,
      }),
    ].join("\n\n"),
  });
};

const extractOrderCommodity = (order) => {
  try {
    const parsed = typeof order.parsed_payload === "string"
      ? JSON.parse(order.parsed_payload)
      : order.parsed_payload || {};
    return String(parsed.commodity || "").trim();
  } catch (_error) {
    return "";
  }
};

const notifyBuyerWithAlternatives = async ({ order, searchTerm, excludeSellerMaskedId }) => {
  if (!order?.buyer_phone || !searchTerm) return { offered: 0 };

  const buyerProfileResult = order.buyer_masked_id
    ? await query(
        `SELECT delivery_latitude, delivery_longitude FROM platform_users WHERE masked_id = $1 LIMIT 1`,
        [order.buyer_masked_id]
      )
    : { rows: [] };
  const buyerProfile = buyerProfileResult.rows[0] || null;

  const rowsResult = await searchCatalogRows({
    searchTerm,
    excludeSellerMaskedId,
  });
  const ranked = rankSearchRowsForBuyer({
    rows: rowsResult.rows,
    buyer: buyerProfile,
  });

  if (ranked.length === 0) {
    await safeNotifyWhatsappPhone({
      toPhone: order.buyer_phone,
      message:
        "Sorry, the selected seller is out of stock and no nearby alternatives were found. Reply 2 to cancel this order.",
    });
    return { offered: 0 };
  }

  const interactiveList = buildSearchInteractiveList({
    searchTerm,
    rankedRows: ranked,
  });
  const textList = buildSearchTextList({
    searchTerm,
    rankedRows: ranked,
  });

  await safeNotifyWhatsappPhone({
    toPhone: order.buyer_phone,
    message:
      `Out of stock at your selected seller. We found alternatives for "${searchTerm}".` +
      "\nSelect one from the list, reply with row ID, reply 1 for best option, or 2 to cancel.",
    interactiveList,
  });
  await safeNotifyWhatsappPhone({
    toPhone: order.buyer_phone,
    message: textList,
  });

  if (order.buyer_masked_id) {
    await query(
      `
        UPDATE platform_users
        SET current_step = 'AWAITING_SEARCH_SELECTION',
            pending_order_id = $2,
            pending_transport_payload = $3,
            updated_at = NOW()
        WHERE masked_id = $1
      `,
      [
        order.buyer_masked_id,
        order.id,
        JSON.stringify({
          source: "out_of_stock_alternatives",
          searchTerm,
          options: ranked.slice(0, 10).map((row) => ({
            catalogItemId: row.catalog_item_id,
            sellerMaskedId: row.seller_masked_id,
          })),
        }),
      ]
    );
  }

  return { offered: ranked.length };
};

const listOpenTransportJobsForDriver = async ({ driverMaskedId }) => {
  const jobs = await listQueuedJobsForDriver({ driverMaskedId });

  if (jobs.length === 0) {
    return "No open transport jobs right now.";
  }

  const lines = ["Targeted transport jobs (claim with: Claim <OrderID>):"];
  for (const job of jobs) {
    lines.push(
      "",
      `#${job.id}`,
      `${job.transport_job_category} | ${job.requested_vehicle_type}`,
      `${job.pickup_location_label} -> ${job.delivery_location}`,
      `Corridor: ${job.corridor_key || "n/a"}`,
      `Raw fare: KSh ${Number(job.raw_transport_fee_kes || 0).toLocaleString()}`
    );
  }
  return lines.join("\n");
};

const claimTransportJobForDriver = async ({ orderId, driverMaskedId }) =>
  claimBroadcastJob({ orderId, driverMaskedId });

const createTransportOnlyOrder = async ({
  requesterUser,
  senderPhone,
  rawMessage,
  payload,
}) =>
  transaction(async (client) => {
    const hasCoords =
      payload.pickupLat != null &&
      payload.pickupLng != null &&
      payload.dropoffLat != null &&
      payload.dropoffLng != null;

    const distanceResult = hasCoords
      ? await resolveRouteDistance({
          fromLat: payload.pickupLat,
          fromLng: payload.pickupLng,
          toLat: payload.dropoffLat,
          toLng: payload.dropoffLng,
        })
      : {
          distanceKm: Number(env.businessRules.transportBaseDistanceKm),
          distanceProvider: "default-distance-estimate",
        };

    const transport = {
      ...computeTransportBreakdown({ distanceKm: distanceResult.distanceKm }),
      distanceProvider: distanceResult.distanceProvider,
    };

    const requesterCommissionPercent = Number(
      resolveTieredCommissionPercent(transport.rawTransportFeeKes)
    );
    const transporterCommissionPercent = Number(env.businessRules.logisticsPremiumPercent);
    const requesterCommissionKes = Number(
      ((transport.rawTransportFeeKes * requesterCommissionPercent) / 100).toFixed(2)
    );
    const transporterCommissionKes = Number(
      ((transport.rawTransportFeeKes * transporterCommissionPercent) / 100).toFixed(2)
    );
    const requesterSubtotalKes = Number(
      (transport.rawTransportFeeKes + requesterCommissionKes).toFixed(2)
    );
    const requesterTotalKes = requesterSubtotalKes;
    const incomingGatewayFeeKes = computeIncomingGatewayFeeKes(requesterTotalKes);
    const transporterNetPayoutKes = Number(
      (transport.rawTransportFeeKes - transporterCommissionKes).toFixed(2)
    );
    const platformFeeKes = Number((requesterCommissionKes + transporterCommissionKes).toFixed(2));
    const { otp, otpHash } = await generateEscrowToken();

    const orderInsert = await client.query(
      `
        INSERT INTO orders (
          source_channel,
          buyer_phone,
          buyer_name,
          raw_message,
          parsed_payload,
          quantity,
          delivery_location,
          total_amount_kes,
          platform_fee_kes,
          incoming_gateway_fee_kes,
          vendor_amount_kes,
          driver_amount_kes,
          delivery_fee_kes,
          otp_code_hash,
          otp_expires_at,
          payment_status,
          settlement_status,
          distribution_status,
          buyer_masked_id,
          transporter_masked_id,
          commission_percent,
          logistics_premium_percent,
          matching_commission_kes,
          logistics_premium_kes,
          distance_km,
          base_transport_fee_kes,
          extra_distance_km,
          extra_distance_fee_kes,
          raw_transport_fee_kes,
          transport_rate_payload,
          order_type,
          transport_job_category,
          requested_vehicle_type,
          pickup_location_label,
          requester_commission_percent,
          requester_commission_kes,
          transporter_commission_percent,
          transporter_commission_kes
        )
        VALUES (
          'WHATSAPP',
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW() + INTERVAL '12 hours',
          'PENDING_PAYMENT',
          'NOT_STARTED',
          'NOT_STARTED',
          $14,NULL,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'TRANSPORT_ONLY',$25,$26,$27,$28,$29,$30,$31
        )
        RETURNING *
      `,
      [
        senderPhone,
        requesterUser.company_name || "Transport requester",
        rawMessage,
        JSON.stringify({
          source: "transport_only_request",
          category: payload.category,
          pickupLabel: payload.pickupLabel,
          dropoffLabel: payload.dropoffLabel,
          vehicleType: payload.vehicleType,
          pickupLat: payload.pickupLat || null,
          pickupLng: payload.pickupLng || null,
          dropoffLat: payload.dropoffLat || null,
          dropoffLng: payload.dropoffLng || null,
        }),
        1,
        payload.dropoffLabel,
        requesterTotalKes,
        platformFeeKes,
        incomingGatewayFeeKes,
        0,
        transporterNetPayoutKes,
        transport.rawTransportFeeKes,
        otpHash,
        requesterUser.masked_id,
        requesterCommissionPercent,
        transporterCommissionPercent,
        requesterCommissionKes,
        transporterCommissionKes,
        transport.distanceKm,
        transport.baseFeeKes,
        transport.extraDistanceKm,
        transport.extraDistanceFeeKes,
        transport.rawTransportFeeKes,
        JSON.stringify({
          ...transport,
          requesterCommissionPercent,
          requesterCommissionKes,
          requesterTotalKes,
          transporterCommissionPercent,
          transporterCommissionKes,
          transporterNetPayoutKes,
          routeLabel: `${payload.pickupLabel} -> ${payload.dropoffLabel}`,
        }),
        payload.category,
        payload.vehicleType,
        payload.pickupLabel,
        requesterCommissionPercent,
        requesterCommissionKes,
        transporterCommissionPercent,
        transporterCommissionKes,
      ]
    );

    await client.query(
      `
        UPDATE platform_users
        SET current_step = 'AWAITING_ORDER_CONFIRM',
            pending_order_id = $2,
            pending_transport_payload = $3,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        requesterUser.id,
        orderInsert.rows[0].id,
        JSON.stringify({
          transportOnly: true,
          category: payload.category,
          pickupLabel: payload.pickupLabel,
          dropoffLabel: payload.dropoffLabel,
          vehicleType: payload.vehicleType,
        }),
      ]
    );

    await client.query(
      `
        INSERT INTO admin_action_events (
          order_id,
          actor_phone,
          action_type,
          action_payload
        )
        VALUES ($1, $2, 'TRANSPORT_JOB_OPENED', $3)
      `,
      [
        orderInsert.rows[0].id,
        requesterUser.masked_id,
        JSON.stringify({
          orderId: orderInsert.rows[0].id,
          category: payload.category,
          vehicleType: payload.vehicleType,
          route: `${payload.pickupLabel} -> ${payload.dropoffLabel}`,
        }),
      ]
    );

    return {
      order: orderInsert.rows[0],
      transport,
      requesterCommissionPercent,
      requesterCommissionKes,
      incomingGatewayFeeKes,
      requesterTotalKes,
      transporterCommissionPercent,
      transporterCommissionKes,
      transporterNetPayoutKes,
      pickupLabel: payload.pickupLabel,
      dropoffLabel: payload.dropoffLabel,
      vehicleType: payload.vehicleType,
      otp,
    };
  });

const processTransportFlowStep = async ({ user, rawMessage, senderPhone }) => {
  const trimmed = rawMessage.trim();

  if (user.current_step === "TRANSPORT_CATEGORY") {
    const category = parseTransportCategory(trimmed);
    if (!category) {
      return transportCategoryMenu();
    }
    await query(
      `
        UPDATE platform_users
        SET current_step = 'TRANSPORT_PICKUP',
            pending_transport_payload = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [user.id, JSON.stringify({ category })]
    );
    return "Where are the items being picked up? Share town name or coordinates (lat,lng).";
  }

  let payload = user.pending_transport_payload || {};
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (_err) {
      payload = {};
    }
  }

  if (user.current_step === "TRANSPORT_PICKUP") {
    const coords = parseCoordinates(trimmed);
    payload = {
      ...payload,
      pickupLabel: trimmed,
      pickupLat: coords ? coords.latitude : null,
      pickupLng: coords ? coords.longitude : null,
    };
    await query(
      `
        UPDATE platform_users
        SET current_step = 'TRANSPORT_DROPOFF',
            pending_transport_payload = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [user.id, JSON.stringify(payload)]
    );
    return "Where are the items going? Share destination town or coordinates (lat,lng).";
  }

  if (user.current_step === "TRANSPORT_DROPOFF") {
    const coords = parseCoordinates(trimmed);
    payload = {
      ...payload,
      dropoffLabel: trimmed,
      dropoffLat: coords ? coords.latitude : null,
      dropoffLng: coords ? coords.longitude : null,
    };
    await query(
      `
        UPDATE platform_users
        SET current_step = 'TRANSPORT_VEHICLE',
            pending_transport_payload = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [user.id, JSON.stringify(payload)]
    );
    return transportVehicleMenu();
  }

  if (user.current_step === "TRANSPORT_VEHICLE") {
    const vehicleType = parseVehicleType(trimmed);
    if (!vehicleType) {
      return transportVehicleMenu();
    }

    payload = {
      ...payload,
      vehicleType,
    };

    if (!payload.category || !payload.pickupLabel || !payload.dropoffLabel) {
      await query(
        `
          UPDATE platform_users
          SET current_step = 'COMPLETED',
              pending_transport_payload = NULL,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return "Transport flow reset due to missing data. Type Transport to restart.";
    }

    const transportOrder = await createTransportOnlyOrder({
      requesterUser: user,
      senderPhone,
      rawMessage,
      payload,
    });

    const broadcastSummary = await enqueueTransportJobBroadcasts({
      orderId: transportOrder.order.id,
      requestedVehicleType: transportOrder.vehicleType,
      pickupLocationLabel: transportOrder.pickupLabel,
      dropoffLocationLabel: transportOrder.dropoffLabel,
    });

    return formatTransportOnlySummary({
      category: payload.category,
      pickupLabel: payload.pickupLabel,
      dropoffLabel: payload.dropoffLabel,
      vehicleType: payload.vehicleType,
      transport: transportOrder.transport,
      requesterCommissionPercent: transportOrder.requesterCommissionPercent,
      requesterCommissionKes: transportOrder.requesterCommissionKes,
      incomingGatewayFeeKes: transportOrder.incomingGatewayFeeKes,
      requesterTotalKes: transportOrder.requesterTotalKes,
      transporterCommissionPercent: transportOrder.transporterCommissionPercent,
      broadcastedDrivers: broadcastSummary.queuedDrivers,
      corridorKey: broadcastSummary.corridorKey,
    });
  }

  return "Transport flow unknown state. Type Transport to restart.";
};

const processSupplierLogisticsStep = async ({ user, rawMessage }) => {
  const trimmed = rawMessage.trim();
  const orderId = user.pending_order_id;
  if (!orderId) {
    await query(
      `
        UPDATE platform_users
        SET current_step = 'COMPLETED',
            pending_transport_payload = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [user.id]
    );
    return "No pending order found. Type 'buy' to continue.";
  }

  if (user.current_step === "AWAITING_SUPPLIER_LOGISTICS_CHOICE") {
    if (trimmed === "1") {
      const result = await transaction(async (client) => {
        const orderResult = await client.query(
          `
            SELECT *
            FROM orders
            WHERE id = $1
              AND supplier_masked_id = $2
            FOR UPDATE
          `,
          [orderId, user.masked_id]
        );
        if (orderResult.rowCount === 0) {
          throw new Error("Pending supplier order not found");
        }
        const order = orderResult.rows[0];
        if (order.payment_status !== "PENDING_PAYMENT") {
          throw new Error("Logistics mode can only be changed before payment prompt.");
        }

        const logisticsPremiumKes = Number(order.logistics_premium_kes || 0);
        const updatedPlatformFeeKes = Number(
          (Number(order.platform_fee_kes || 0) - logisticsPremiumKes).toFixed(2)
        );
        const updatedTotalKes = Number(
          (Number(order.total_amount_kes || 0) - logisticsPremiumKes).toFixed(2)
        );
        const updatedVendorAmountKes = Number(
          (Number(order.vendor_amount_kes || 0) + Number(order.driver_amount_kes || 0)).toFixed(2)
        );
        const incomingGatewayFeeKes = computeIncomingGatewayFeeKes(updatedTotalKes);

        const updatedOrderResult = await client.query(
          `
            UPDATE orders
            SET vendor_amount_kes = $2,
                driver_amount_kes = 0,
                delivery_fee_kes = raw_transport_fee_kes,
                platform_fee_kes = $3,
                total_amount_kes = $4,
                incoming_gateway_fee_kes = $5,
                logistics_premium_percent = 0,
                logistics_premium_kes = 0,
                requested_vehicle_type = NULL,
                transporter_masked_id = NULL,
                transporter_assigned_at = NULL,
                seller_logistics_mode = 'SELLER_OWN_TRANSPORT',
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
          `,
          [
            order.id,
            updatedVendorAmountKes,
            updatedPlatformFeeKes,
            updatedTotalKes,
            incomingGatewayFeeKes,
          ]
        );

        await client.query(
          `
            UPDATE platform_users
            SET current_step = 'COMPLETED',
                pending_order_id = NULL,
                pending_transport_payload = NULL,
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id]
        );

        return updatedOrderResult.rows[0];
      });

      await notifyBuyerCheckoutReady({
        order: result,
        modeLabel: "Seller own delivery",
      });
      return "Own transport selected. Driver network will NOT be notified. Buyer has been prompted to confirm payment.";
    }

    if (trimmed === "2") {
      await query(
        `
          UPDATE platform_users
          SET current_step = 'AWAITING_SUPPLIER_VEHICLE_SELECTION',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return sellerVehicleSelectionMenu();
    }
    return sellerLogisticsChoiceMenu();
  }

  if (user.current_step === "AWAITING_SUPPLIER_STOCK_CONFIRM") {
    if (trimmed === "1") {
      const stockResult = await transaction(async (client) => {
        const orderResult = await client.query(
          `
            SELECT *
            FROM orders
            WHERE id = $1
              AND supplier_masked_id = $2
            FOR UPDATE
          `,
          [orderId, user.masked_id]
        );
        if (orderResult.rowCount === 0) {
          throw new Error("Pending supplier order not found");
        }
        const order = orderResult.rows[0];
        let parsedPayload = {};
        try {
          parsedPayload = typeof order.parsed_payload === "string"
            ? JSON.parse(order.parsed_payload)
            : order.parsed_payload || {};
        } catch (_error) {
          parsedPayload = {};
        }

        const catalogItemResult = await client.query(
          `
            SELECT id, stock_quantity
            FROM catalog_items
            WHERE seller_masked_id = $1
              AND (
                ($2::bigint IS NOT NULL AND id = $2)
                OR ($2::bigint IS NULL AND LOWER(commodity_name) = LOWER($3))
              )
            LIMIT 1
          `,
          [user.masked_id, parsedPayload.catalogItemId || null, parsedPayload.commodity || ""]
        );
        if (catalogItemResult.rowCount === 0) {
          throw new Error("Catalog item not found for stock confirmation");
        }

        const availableStock = Number(catalogItemResult.rows[0].stock_quantity || 0);
        const requestedQty = Number(order.quantity || 0);
        if (availableStock < requestedQty) {
          await client.query(
            `
              UPDATE orders
              SET seller_stock_status = 'OUT_OF_STOCK',
                  payment_status = 'PAYMENT_FAILED',
                  settlement_status = 'ON_HOLD',
                  distribution_status = 'ON_HOLD',
                  updated_at = NOW()
              WHERE id = $1
            `,
            [order.id]
          );
          await client.query(
            `
              UPDATE platform_users
              SET current_step = 'COMPLETED',
                  pending_order_id = NULL,
                  pending_transport_payload = NULL,
                  updated_at = NOW()
              WHERE id = $1
            `,
            [user.id]
          );
          return { forcedOutOfStock: true, order };
        }

        await client.query(
          `
            UPDATE orders
            SET seller_stock_status = 'IN_STOCK',
                updated_at = NOW()
            WHERE id = $1
          `,
          [order.id]
        );
        await client.query(
          `
            UPDATE platform_users
            SET current_step = 'AWAITING_SUPPLIER_LOGISTICS_CHOICE',
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id]
        );
        return { forcedOutOfStock: false, order };
      });

      if (stockResult.forcedOutOfStock) {
        const commodity = extractOrderCommodity(stockResult.order);
        await notifyBuyerWithAlternatives({
          order: stockResult.order,
          searchTerm: commodity,
          excludeSellerMaskedId: stockResult.order.supplier_masked_id,
        });
        return "Stock level is insufficient for requested quantity. Buyer has been redirected to alternatives.";
      }

      return sellerLogisticsChoiceMenu();
    }

    if (trimmed === "2") {
      const orderResult = await query(
        `
          UPDATE orders
          SET seller_stock_status = 'OUT_OF_STOCK',
              payment_status = 'PAYMENT_FAILED',
              settlement_status = 'ON_HOLD',
              distribution_status = 'ON_HOLD',
              updated_at = NOW()
          WHERE id = $1
            AND supplier_masked_id = $2
          RETURNING *
        `,
        [orderId, user.masked_id]
      );
      if (orderResult.rowCount > 0) {
        const order = orderResult.rows[0];
        const commodity = extractOrderCommodity(order);
        await notifyBuyerWithAlternatives({
          order,
          searchTerm: commodity,
          excludeSellerMaskedId: order.supplier_masked_id,
        });
      }
      await query(
        `
          UPDATE platform_users
          SET current_step = 'COMPLETED',
              pending_order_id = NULL,
              pending_transport_payload = NULL,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return "Out-of-stock status recorded. Buyer has been notified with alternative seller options.";
    }

    return sellerStockConfirmationMenu({ orderId });
  }

  if (user.current_step === "AWAITING_SUPPLIER_VEHICLE_SELECTION") {
    const selected = parseSellerVehicleChoice(trimmed);
    if (!selected) {
      return sellerVehicleSelectionMenu();
    }

    const updatePayload = await transaction(async (client) => {
      const orderResult = await client.query(
        `
          SELECT *
          FROM orders
          WHERE id = $1
            AND supplier_masked_id = $2
          FOR UPDATE
        `,
        [orderId, user.masked_id]
      );
      if (orderResult.rowCount === 0) {
        throw new Error("Pending supplier order not found");
      }
      const order = orderResult.rows[0];
      if (order.payment_status !== "PENDING_PAYMENT") {
        throw new Error("Vehicle can only be selected before payment prompt.");
      }

      const updated = await client.query(
        `
          UPDATE orders
          SET seller_logistics_mode = 'AGIZAHUB_MATCHING',
              requested_vehicle_type = $2,
              transporter_masked_id = NULL,
              transporter_assigned_at = NULL,
              updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [order.id, selected.vehicleType]
      );

      await client.query(
        `
          UPDATE platform_users
          SET current_step = 'COMPLETED',
              pending_order_id = NULL,
              pending_transport_payload = NULL,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );

      return updated.rows[0];
    });

    const broadcastSummary = await enqueueTransportJobBroadcasts({
      orderId: updatePayload.id,
      requestedVehicleType: selected.vehicleType,
      pickupLocationLabel: updatePayload.pickup_location_label || "supplier-hub",
      dropoffLocationLabel: updatePayload.delivery_location || "buyer-destination",
    });

    if (broadcastSummary.queuedDrivers === 0) {
      await query(
        `
          UPDATE orders
          SET seller_logistics_mode = 'PENDING_SELLER_DECISION',
              requested_vehicle_type = NULL,
              updated_at = NOW()
          WHERE id = $1
        `,
        [updatePayload.id]
      );
      await query(
        `
          UPDATE platform_users
          SET current_step = 'AWAITING_SUPPLIER_LOGISTICS_CHOICE',
              pending_order_id = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, updatePayload.id]
      );
      return "No matching transporters found right now for that vehicle type. Reply 1 to use own transport or 2 to retry matching.";
    }

    await notifyBuyerCheckoutReady({
      order: updatePayload,
      modeLabel: `AgizaHub matched transport (${selected.label})`,
    });

    return `Vehicle selected: ${selected.label}. Broadcast sent to ${broadcastSummary.queuedDrivers} matching transporters.`;
  }

  return "Logistics step reset. Reply with 1 (own transport) or 2 (need AgizaHub transporter).";
};

const createOrderFromCatalogRequest = async ({
  buyer,
  senderPhone,
  rawMessage,
  sellerMaskedId,
  quantity,
  catalogItemId = null,
}) =>
  transaction(async (client) => {
    const seller = await resolveUserByMaskedId(client, sellerMaskedId);
    if (!seller || seller.user_type !== "SUPPLIER") {
      throw new Error("Supplier ID not found");
    }
    if (seller.merchant_agreement_status !== "ACCEPTED") {
      throw new Error("Supplier catalog is not active yet");
    }

    if (
      seller.hub_latitude == null ||
      seller.hub_longitude == null ||
      buyer.delivery_latitude == null ||
      buyer.delivery_longitude == null
    ) {
      throw new Error(
        "Missing coordinates. Supplier and buyer must complete location onboarding."
      );
    }

    const itemResult = await client.query(
      `
        SELECT *
        FROM catalog_items
        WHERE seller_masked_id = $1
          AND is_active = TRUE
          AND stock_quantity > 0
          AND ($2::bigint IS NULL OR id = $2)
        ORDER BY
          CASE WHEN $2::bigint IS NULL THEN price_per_unit END ASC,
          created_at ASC
        LIMIT 1
      `,
      [sellerMaskedId, catalogItemId]
    );
    if (itemResult.rowCount === 0) {
      throw new Error("Supplier has no active catalog item");
    }
    const catalogItem = itemResult.rows[0];
    if (Number(catalogItem.stock_quantity || 0) < Number(quantity || 0)) {
      throw new Error("Requested quantity exceeds seller stock.");
    }

    const itemSubtotal = Number(quantity) * Number(catalogItem.price_per_unit);

    const distanceResult = await resolveRouteDistance({
      fromLat: seller.hub_latitude,
      fromLng: seller.hub_longitude,
      toLat: buyer.delivery_latitude,
      toLng: buyer.delivery_longitude,
    });
    const routeLabel = `${catalogItem.location_label} -> ${
      buyer.company_name || `Buyer #${buyer.masked_id} shop`
    }`;
    const transport = {
      ...computeTransportBreakdown({ distanceKm: distanceResult.distanceKm }),
      distanceProvider: distanceResult.distanceProvider,
      routeLabel,
    };
    const checkoutValueKes = Number(
      (itemSubtotal + transport.totalTransportFeeKes).toFixed(2)
    );
    const matchingPercent = Number(resolveTieredCommissionPercent(checkoutValueKes));
    const matchingCommission = Number(
      ((itemSubtotal * matchingPercent) / 100).toFixed(2)
    );
    const vendorAmount = Number((itemSubtotal - matchingCommission).toFixed(2));
    const driverAmount = Number(transport.rawTransportFeeKes);
    const platformFee = Number(
      (matchingCommission + transport.logisticsPremiumKes).toFixed(2)
    );
    const totalAmount = Number(
      (itemSubtotal + transport.totalTransportFeeKes).toFixed(2)
    );
    const incomingGatewayFeeKes = computeIncomingGatewayFeeKes(totalAmount);
    const { otp, otpHash } = await generateEscrowToken();

    const orderInsert = await client.query(
      `
        INSERT INTO orders (
          source_channel,
          buyer_phone,
          buyer_name,
          raw_message,
          parsed_payload,
          quantity,
          delivery_location,
          total_amount_kes,
          platform_fee_kes,
          incoming_gateway_fee_kes,
          vendor_amount_kes,
          driver_amount_kes,
          delivery_fee_kes,
          otp_code_hash,
          otp_expires_at,
          payment_status,
          settlement_status,
          distribution_status,
          buyer_masked_id,
          supplier_masked_id,
          transporter_masked_id,
          seller_logistics_mode,
          commission_percent,
          logistics_premium_percent,
          matching_commission_kes,
          logistics_premium_kes,
          distance_km,
          base_transport_fee_kes,
          extra_distance_km,
          extra_distance_fee_kes,
          raw_transport_fee_kes,
          transport_rate_payload,
          order_type,
          requested_vehicle_type,
          pickup_location_label,
          transporter_assigned_at
        )
        VALUES (
          'WHATSAPP',
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW() + INTERVAL '12 hours',
          'PENDING_PAYMENT',
          'NOT_STARTED',
          'NOT_STARTED',
          $14,$15,NULL,'PENDING_SELLER_DECISION',$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,'SUPPLY',NULL,$26,
          NULL
        )
        RETURNING *
      `,
      [
        senderPhone,
        buyer.company_name || "Buyer",
        rawMessage,
        JSON.stringify({
          source: "catalog_buy_command",
          sellerMaskedId,
          catalogItemId: catalogItem.id,
          quantity,
          commodity: catalogItem.commodity_name,
          pricePerUnit: catalogItem.price_per_unit,
        }),
        quantity,
        catalogItem.location_label,
        totalAmount,
        platformFee,
        incomingGatewayFeeKes,
        vendorAmount,
        driverAmount,
        transport.totalTransportFeeKes,
        otpHash,
        buyer.masked_id,
        seller.masked_id,
        matchingPercent,
        transport.logisticsPremiumPercent,
        matchingCommission,
        transport.logisticsPremiumKes,
        transport.distanceKm,
        transport.baseFeeKes,
        transport.extraDistanceKm,
        transport.extraDistanceFeeKes,
        transport.rawTransportFeeKes,
        JSON.stringify(transport),
        catalogItem.location_label,
      ]
    );

    await client.query(
      `
        UPDATE platform_users
        SET current_step = 'AWAITING_ORDER_CONFIRM',
            pending_order_id = $2,
            pending_transport_payload = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [buyer.id, orderInsert.rows[0].id]
    );

    await client.query(
      `
        UPDATE platform_users
        SET current_step = 'AWAITING_SUPPLIER_STOCK_CONFIRM',
            pending_order_id = $2,
            pending_transport_payload = $3,
            updated_at = NOW()
        WHERE masked_id = $1
      `,
      [
        seller.masked_id,
        orderInsert.rows[0].id,
        JSON.stringify({
          orderId: orderInsert.rows[0].id,
          buyerMaskedId: buyer.masked_id,
        }),
      ]
    );

    return {
      order: orderInsert.rows[0],
      seller,
      buyer,
      catalogItem,
      transport,
      routeLabel,
      itemSubtotal,
      quantity,
      otp,
    };
  });

const confirmPendingOrderPayment = async ({ user, senderPhone }) =>
  transaction(async (client) => {
    if (!user.pending_order_id) {
      throw new Error("No pending order awaiting confirmation");
    }

    const orderResult = await client.query(
      `
        SELECT *
        FROM orders
        WHERE id = $1
          AND buyer_masked_id = $2
        FOR UPDATE
      `,
      [user.pending_order_id, user.masked_id]
    );
    if (orderResult.rowCount === 0) {
      throw new Error("Pending order not found");
    }
    const order = orderResult.rows[0];
    if (
      order.order_type === "SUPPLY" &&
      (order.seller_logistics_mode || "PENDING_SELLER_DECISION") ===
        "PENDING_SELLER_DECISION"
    ) {
      throw new Error("Seller must confirm logistics mode before checkout.");
    }

    const existingTxn = await client.query(
      `
        SELECT 1
        FROM mpesa_stk_transactions
        WHERE order_id = $1
        LIMIT 1
      `,
      [order.id]
    );
    if (existingTxn.rowCount > 0) {
      await client.query(
        `
          UPDATE platform_users
          SET current_step = 'COMPLETED',
              pending_order_id = NULL,
              pending_transport_payload = NULL,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return {
        orderId: order.id,
        totalAmountKes: Number(order.total_amount_kes),
        alreadyInitiated: true,
      };
    }

    const transactionDesc =
      order.order_type === "TRANSPORT_ONLY"
        ? `AgizaHub Transport ${order.pickup_location_label || ""} -> ${
            order.delivery_location || ""
          }`.trim()
        : `AgizaHub Seller #${order.supplier_masked_id || "N/A"}`;

    const stkResponse = await initiateStkPush({
      phoneNumber: senderPhone,
      amount: order.total_amount_kes,
      accountReference: `ORD-${order.id.slice(0, 8)}`,
      transactionDesc,
    });

    await client.query(
      `
        INSERT INTO mpesa_stk_transactions (
          order_id,
          checkout_request_id,
          merchant_request_id,
          amount_kes,
          msisdn,
          status,
          raw_response
        )
        VALUES ($1,$2,$3,$4,$5,'REQUESTED',$6)
      `,
      [
        order.id,
        stkResponse.CheckoutRequestID,
        stkResponse.MerchantRequestID || null,
        order.total_amount_kes,
        senderPhone,
        JSON.stringify(stkResponse),
      ]
    );

    await client.query(
      `
        UPDATE orders
        SET mpesa_checkout_request_id = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [order.id, stkResponse.CheckoutRequestID]
    );

    await client.query(
      `
        UPDATE platform_users
        SET current_step = 'COMPLETED',
            pending_order_id = NULL,
            pending_transport_payload = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [user.id]
    );

    return {
      orderId: order.id,
      totalAmountKes: Number(order.total_amount_kes),
      alreadyInitiated: false,
    };
  });

const processLegacyAiOrder = async ({ rawMessage, senderPhone, senderName }) => {
  const parsed = await parseMarketplaceMessage(rawMessage);
  if (parsed.intent !== "order_request") {
    return {
      errorMessage:
        "Sijaelewa order. Tumia Buy [Seller ID] [Qty] ama andika 'buy' kuona offers.",
    };
  }

  const payload = await transaction(async (client) => {
    const product = await resolveProduct(client, parsed.product);
    if (!product) {
      throw new Error("Product not found. Add it in products/product_slang first.");
    }

    const inventoryResult = await resolveVendorInventory(
      client,
      product.id,
      parsed.preferredVendor
    );
    if (inventoryResult.rowCount === 0) {
      throw new Error("No active vendor inventory found for this product.");
    }
    const inventory = inventoryResult.rows[0];
    const transporterResult = await resolvePlatformTransporter(client);
    const transporter = transporterResult.rows[0] || null;

    const quantity = Number(parsed.quantity || 1);
    const itemSubtotal = quantity * Number(inventory.price_kes);
    const transport = computeTransportBreakdown({
      distanceKm: env.businessRules.transportBaseDistanceKm,
    });
    const checkoutValueKes = Number(
      (itemSubtotal + transport.totalTransportFeeKes).toFixed(2)
    );
    const matchingPercent = Number(resolveTieredCommissionPercent(checkoutValueKes));
    const matchingCommission = Number(
      ((itemSubtotal * matchingPercent) / 100).toFixed(2)
    );
    const platformFee = Number(
      (matchingCommission + transport.logisticsPremiumKes).toFixed(2)
    );
    const vendorAmount = Number((itemSubtotal - matchingCommission).toFixed(2));
    const driverAmount = Number(transport.rawTransportFeeKes);
    const totalAmount = Number(
      (itemSubtotal + transport.totalTransportFeeKes).toFixed(2)
    );
    const incomingGatewayFeeKes = computeIncomingGatewayFeeKes(totalAmount);
    const { otp, otpHash } = await generateEscrowToken();

    const orderResult = await client.query(
      `
        INSERT INTO orders (
          source_channel,
          buyer_phone,
          buyer_name,
          raw_message,
          parsed_payload,
          product_id,
          quantity,
          delivery_location,
          vendor_id,
          transporter_id,
          total_amount_kes,
          platform_fee_kes,
          incoming_gateway_fee_kes,
          vendor_amount_kes,
          driver_amount_kes,
          delivery_fee_kes,
          otp_code_hash,
          otp_expires_at,
          payment_status,
          settlement_status,
          distribution_status,
          commission_percent,
          logistics_premium_percent,
          matching_commission_kes,
          logistics_premium_kes,
          distance_km,
          base_transport_fee_kes,
          extra_distance_km,
          extra_distance_fee_kes,
          raw_transport_fee_kes,
          transport_rate_payload,
          order_type,
          requested_vehicle_type,
          pickup_location_label,
          transporter_masked_id,
          transporter_assigned_at
        )
        VALUES (
          'WHATSAPP',
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW() + INTERVAL '12 hours',
          'PENDING_PAYMENT',
          'NOT_STARTED',
          'NOT_STARTED',
          $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'SUPPLY',$27,$28,$29,
          CASE WHEN $29 IS NULL THEN NULL ELSE NOW() END
        )
        RETURNING *
      `,
      [
        senderPhone,
        senderName,
        rawMessage,
        JSON.stringify(parsed),
        product.id,
        quantity,
        parsed.deliveryLocation || "To be confirmed",
        inventory.vendor_id,
        null,
        totalAmount,
        platformFee,
        incomingGatewayFeeKes,
        vendorAmount,
        driverAmount,
        transport.totalTransportFeeKes,
        otpHash,
        matchingPercent,
        env.businessRules.logisticsPremiumPercent,
        matchingCommission,
        transport.logisticsPremiumKes,
        transport.distanceKm,
        transport.baseFeeKes,
        transport.extraDistanceKm,
        transport.extraDistanceFeeKes,
        transport.rawTransportFeeKes,
        JSON.stringify(transport),
        "TUKTUK_PICKUP",
        inventory.location_label || "Supplier Hub",
        transporter?.masked_id || null,
      ]
    );
    return { order: orderResult.rows[0], inventory, otp };
  });

  return { payload };
};

const nextStepAfterPaymentSelection = (userType) => {
  if (userType === "BUYER") return "AWAITING_BUYER_LOCATION";
  if (userType === "SUPPLIER") return "AWAITING_SUPPLIER_BUSINESS_TYPE";
  if (userType === "TRANSPORTER_BIKE" || userType === "TRANSPORTER_TRUCK") {
    return "AWAITING_TRANSPORTER_CORRIDOR";
  }
  return "COMPLETED";
};

const processOnboardingStep = async ({ user, rawMessage, senderPhone }) => {
  const trimmed = rawMessage.trim();

  return transaction(async (client) => {
    if (!user.user_type) {
      const selectedRole = roleFromChoice(trimmed);
      if (!selectedRole) return onboardingMenu();

      if (selectedRole === "BUYER") {
        await client.query(
          `
            UPDATE platform_users
            SET user_type = $2,
                current_step = 'AWAITING_PAYMENT_MODE',
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id, selectedRole]
        );
        return paymentModeMenu();
      }

      await client.query(
        `
          UPDATE platform_users
          SET user_type = $2,
              current_step = 'AWAITING_COMPANY_NAME',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, selectedRole]
      );
      return "Great. Reply with your official business/company or transporter name.";
    }

    if (user.current_step === "AWAITING_COMPANY_NAME") {
      await client.query(
        `
          UPDATE platform_users
          SET company_name = $2,
              current_step = 'AWAITING_PAYMENT_MODE',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, trimmed.slice(0, 100)]
      );
      return paymentModeMenu();
    }

    if (user.current_step === "AWAITING_PAYMENT_MODE") {
      const paymentMode = paymentModeFromChoice(trimmed);
      if (!paymentMode) return `Invalid option.\n\n${paymentModeMenu()}`;

      if (paymentMode === "SEND_MONEY") {
        const nextStep = nextStepAfterPaymentSelection(user.user_type);
        await client.query(
          `
            UPDATE platform_users
            SET payment_mode = 'SEND_MONEY',
                payout_phone = $2,
                current_step = $3,
                transporter_vehicle_type = COALESCE(transporter_vehicle_type, $4),
                updated_at = NOW()
            WHERE id = $1
          `,
          [
            user.id,
            senderPhone,
            nextStep,
            defaultTransporterVehicleType(user.user_type),
          ]
        );
        if (nextStep === "AWAITING_BUYER_LOCATION") {
          return "Send your delivery location coordinates as: latitude,longitude (example: -1.286389,36.817223)";
        }
        if (nextStep === "AWAITING_SUPPLIER_BUSINESS_TYPE") {
          return supplierBusinessTypeMenu();
        }
        if (nextStep === "AWAITING_SUPPLIER_HUB") {
          return "Send your supplier hub coordinates as: latitude,longitude (example: -0.727322,36.429387)";
        }
        if (nextStep === "AWAITING_TRANSPORTER_CORRIDOR") {
          return "Set your service corridor/town (example: Nairobi Eastlands). You can later change with: corridor <name>.";
        }
        return `Registration complete! Your secure account ID is ${formatPublicMaskedId(
          user.user_type,
          user.masked_id
        )}.`;
      }

      if (paymentMode === "TILL") {
        await client.query(
          `
            UPDATE platform_users
            SET payment_mode = 'TILL',
                current_step = 'AWAITING_TILL_NUMBER',
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id]
        );
        return "Please reply with your 5-7 digit Till Number.";
      }

      await client.query(
        `
          UPDATE platform_users
          SET payment_mode = 'PAYBILL',
              current_step = 'AWAITING_PAYBILL_DETAILS',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return "Please reply with: Business Number, Account Number (e.g., 222222, ACC123)";
    }

    if (user.current_step === "AWAITING_TILL_NUMBER") {
      const till = trimmed.replace(/[^\d]/g, "");
      if (!/^\d{5,7}$/.test(till)) {
        return "Invalid Till Number. Send only 5-7 digits.";
      }
      const nextStep = nextStepAfterPaymentSelection(user.user_type);
      await client.query(
        `
          UPDATE platform_users
          SET business_number = $2,
              current_step = $3,
              transporter_vehicle_type = COALESCE(transporter_vehicle_type, $4),
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, till, nextStep, defaultTransporterVehicleType(user.user_type)]
      );
      if (nextStep === "AWAITING_BUYER_LOCATION") {
        return "Now send buyer delivery coordinates: latitude,longitude";
      }
      if (nextStep === "AWAITING_SUPPLIER_BUSINESS_TYPE") {
        return supplierBusinessTypeMenu();
      }
      if (nextStep === "AWAITING_SUPPLIER_HUB") {
        return "Now send supplier hub coordinates: latitude,longitude";
      }
      if (nextStep === "AWAITING_TRANSPORTER_CORRIDOR") {
        return "Set your service corridor/town (example: Nairobi Eastlands).";
      }
      return `Registration complete! Your secure account ID is ${formatPublicMaskedId(
        user.user_type,
        user.masked_id
      )}.`;
    }

    if (user.current_step === "AWAITING_PAYBILL_DETAILS") {
      const parts = trimmed.split(",");
      if (parts.length < 2) return "Use format: 222222, ACC123";
      const businessNumber = parts[0].replace(/[^\d]/g, "");
      const accountNumber = parts.slice(1).join(",").trim().slice(0, 50);
      if (!businessNumber || !accountNumber) {
        return "Both Business Number and Account Number are required.";
      }
      const nextStep = nextStepAfterPaymentSelection(user.user_type);
      await client.query(
        `
          UPDATE platform_users
          SET business_number = $2,
              account_number = $3,
              current_step = $4,
              transporter_vehicle_type = COALESCE(transporter_vehicle_type, $5),
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          user.id,
          businessNumber,
          accountNumber,
          nextStep,
          defaultTransporterVehicleType(user.user_type),
        ]
      );
      if (nextStep === "AWAITING_BUYER_LOCATION") {
        return "Now send buyer delivery coordinates: latitude,longitude";
      }
      if (nextStep === "AWAITING_SUPPLIER_BUSINESS_TYPE") {
        return supplierBusinessTypeMenu();
      }
      if (nextStep === "AWAITING_SUPPLIER_HUB") {
        return "Now send supplier hub coordinates: latitude,longitude";
      }
      if (nextStep === "AWAITING_TRANSPORTER_CORRIDOR") {
        return "Set your service corridor/town (example: Nairobi Eastlands).";
      }
      return `Registration complete! Your secure account ID is ${formatPublicMaskedId(
        user.user_type,
        user.masked_id
      )}.`;
    }

    if (user.current_step === "AWAITING_BUYER_LOCATION") {
      const coords = parseCoordinates(trimmed);
      if (!coords) {
        return "Invalid location format. Use: latitude,longitude";
      }
      await client.query(
        `
          UPDATE platform_users
          SET delivery_latitude = $2,
              delivery_longitude = $3,
              current_step = 'COMPLETED',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, coords.latitude, coords.longitude]
      );
      return `Registration complete! Your secure account ID is ${formatPublicMaskedId(
        user.user_type,
        user.masked_id
      )}. Type 'buy' to view offers.`;
    }

    if (user.current_step === "AWAITING_SUPPLIER_BUSINESS_TYPE") {
      const businessType = parseSupplierBusinessTypeChoice(trimmed);
      if (!businessType) {
        return `Invalid option.\n\n${supplierBusinessTypeMenu()}`;
      }
      await client.query(
        `
          UPDATE platform_users
          SET business_type = $2,
              current_step = 'AWAITING_SUPPLIER_HUB',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, businessType]
      );
      return "Business type saved. Now send supplier hub coordinates: latitude,longitude";
    }

    if (user.current_step === "AWAITING_SUPPLIER_HUB") {
      const coords = parseCoordinates(trimmed);
      if (!coords) {
        return "Invalid location format. Use: latitude,longitude";
      }
      await client.query(
        `
          UPDATE platform_users
          SET hub_latitude = $2,
              hub_longitude = $3,
              merchant_agreement_status = 'PENDING',
              current_step = 'AWAITING_MERCHANT_AGREEMENT',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, coords.latitude, coords.longitude]
      );
      return (
        `Hub location saved. Seller ID ${formatPublicMaskedId(
          user.user_type,
          user.masked_id
        )}. Business type: ${normalizeSupplierBusinessType(user.business_type)}.\n` +
        `${merchantAgreementMessage()}`
      );
    }

    if (user.current_step === "AWAITING_MERCHANT_AGREEMENT") {
      if (trimmed.toUpperCase() !== "I AGREE") {
        return merchantAgreementMessage();
      }
      await client.query(
        `
          UPDATE platform_users
          SET merchant_agreement_status = 'ACCEPTED',
              merchant_agreement_accepted_at = NOW(),
              current_step = 'AWAITING_CATALOG',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return "Agreement accepted. Your store is now active. Add first catalog line: Item, Price";
    }

    if (user.current_step === "AWAITING_TRANSPORTER_CORRIDOR") {
      const corridor = trimmed.slice(0, 80);
      if (!corridor) {
        return "Please send your corridor/town label (example: Nairobi CBD).";
      }
      await client.query(
        `
          UPDATE platform_users
          SET service_corridor_label = $2,
              current_step = 'COMPLETED',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, corridor]
      );
      return `Transporter profile completed! ID ${formatPublicMaskedId(
        user.user_type,
        user.masked_id
      )}. You can view targeted jobs with 'jobs'.`;
    }

    if (user.current_step === "AWAITING_CATALOG") {
      if (user.merchant_agreement_status !== "ACCEPTED") {
        await client.query(
          `
            UPDATE platform_users
            SET current_step = 'AWAITING_MERCHANT_AGREEMENT',
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id]
        );
        return merchantAgreementMessage();
      }
      const parsedCatalog = await parseAndNormalizeMerchantCatalog({
        rawMessage: trimmed,
        merchantPhone: user.phone_number,
        businessTypeHint: user.business_type,
      });
      if (!parsedCatalog.items.length) {
        return "Invalid catalog format. Use: Commodity, Price (example: Onions, 1800) or paste menu lines for AI parsing.";
      }
      for (const item of parsedCatalog.items) {
        await client.query(
          `
            INSERT INTO catalog_items (
              seller_masked_id,
              commodity_name,
              price_per_unit,
              stock_quantity,
              business_type,
              catalog_metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            user.masked_id,
            item.commodity,
            item.pricePerUnitKes,
            Number(item.stockQuantity || 0),
            parsedCatalog.businessType,
            JSON.stringify(item.metadata),
          ]
        );
      }
      await client.query(
        `
          UPDATE platform_users
          SET current_step = 'COMPLETED',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return `${parsedCatalog.items.length} catalog item(s) saved for Seller #${user.masked_id} (${parsedCatalog.businessType}). Buyers only see masked IDs.`;
    }

    await client.query(
      `
        UPDATE platform_users
        SET current_step = 'START',
            updated_at = NOW()
        WHERE id = $1
      `,
      [user.id]
    );
    return onboardingMenu();
  });
};

const handleIncomingWhatsapp = async (req, res, next) => {
  try {
    const inbound = parseInboundWhatsappPayload(req.body);
    if (inbound.ignore) {
      return acknowledgeWebhook({
        res,
        provider: inbound.provider || env.whatsappGateway.provider,
      });
    }

    const {
      provider,
      rawMessage,
      communicationPhone,
      senderPhone,
      senderName,
    } = inbound;
    const lowerMessage = rawMessage.toLowerCase();

    if (!rawMessage) {
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: onboardingMenu(),
      });
    }

    if (isAdminPhone(communicationPhone, senderPhone)) {
      const adminResponse = await handleAdminCommand(rawMessage, senderPhone);
      if (adminResponse) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: adminResponse,
        });
      }
      return respondToUser({
        res,
        provider,
        senderPhone,
        message:
          "Admin commands: Release <OrderID>, Hold <OrderID>, Approve <OrderID>, Reject <OrderID>.",
      });
    }

    const user = await transaction(async (client) =>
      ensureUserRecord(client, communicationPhone)
    );

    if (
      user.user_type === "SUPPLIER" &&
      lowerMessage === "i agree" &&
      user.merchant_agreement_status !== "ACCEPTED"
    ) {
      const nextStep =
        user.hub_latitude == null || user.hub_longitude == null
          ? "AWAITING_SUPPLIER_HUB"
          : "AWAITING_CATALOG";
      await query(
        `
          UPDATE platform_users
          SET merchant_agreement_status = 'ACCEPTED',
              merchant_agreement_accepted_at = NOW(),
              current_step = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, nextStep]
      );
      return respondToUser({
        res,
        provider,
        senderPhone,
        message:
          nextStep === "AWAITING_SUPPLIER_HUB"
            ? "Agreement accepted. Send supplier hub coordinates as: latitude,longitude"
            : "Agreement accepted. Store active. Add catalog with: Item, Price",
      });
    }

    if (user.user_type === "SUPPLIER" && lowerMessage === "terms") {
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: merchantAgreementMessage(),
      });
    }

    if (user.current_step === "AWAITING_SEARCH_SELECTION") {
      if (["0", "2", "cancel"].includes(lowerMessage)) {
        await query(
          `
            UPDATE platform_users
            SET current_step = 'COMPLETED',
                pending_transport_payload = NULL,
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id]
        );
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Search cancelled.",
        });
      }

      let selection = parseSearchSelectionId(rawMessage);
      if (!selection && rawMessage.trim() === "1") {
        let pending = user.pending_transport_payload || {};
        if (typeof pending === "string") {
          try {
            pending = JSON.parse(pending);
          } catch (_error) {
            pending = {};
          }
        }
        const firstOption = Array.isArray(pending.options) ? pending.options[0] : null;
        if (firstOption) {
          selection = {
            catalogItemId: Number(firstOption.catalogItemId),
            sellerMaskedId: String(firstOption.sellerMaskedId),
          };
        }
      }
      if (!selection) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            "Reply with a valid selection ID (search_select_<catalog>_<seller>), 1 for best option, or 2 to cancel.",
        });
      }

      const rowResult = await query(
        `
          SELECT
            c.id AS catalog_item_id,
            c.seller_masked_id,
            c.commodity_name,
            c.price_per_unit,
            c.unit_measure,
            c.location_label,
            c.stock_quantity,
            u.company_name
          FROM catalog_items c
          JOIN platform_users u ON u.masked_id = c.seller_masked_id
          WHERE c.id = $1
            AND c.seller_masked_id = $2
            AND c.is_active = TRUE
            AND c.stock_quantity > 0
            AND COALESCE(u.merchant_agreement_status, 'PENDING') = 'ACCEPTED'
          LIMIT 1
        `,
        [selection.catalogItemId, selection.sellerMaskedId]
      );
      if (rowResult.rowCount === 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "That option is no longer available. Please search again.",
        });
      }

      await query(
        `
          UPDATE platform_users
          SET current_step = 'AWAITING_SEARCH_QUANTITY',
              pending_transport_payload = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          user.id,
          JSON.stringify({
            source: "catalog_search_selection",
            catalogItemId: selection.catalogItemId,
            sellerMaskedId: selection.sellerMaskedId,
          }),
        ]
      );

      return respondToUser({
        res,
        provider,
        senderPhone,
        message: buildSearchQuantityPrompt({ row: rowResult.rows[0] }),
      });
    }

    if (user.current_step === "AWAITING_SEARCH_QUANTITY") {
      if (["0", "cancel"].includes(lowerMessage)) {
        await query(
          `
            UPDATE platform_users
            SET current_step = 'COMPLETED',
                pending_transport_payload = NULL,
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id]
        );
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Quantity input cancelled.",
        });
      }

      const qty = Number(rawMessage.trim());
      if (!Number.isFinite(qty) || qty <= 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Please send a valid quantity number (or 0 to cancel).",
        });
      }

      let pending = user.pending_transport_payload || {};
      if (typeof pending === "string") {
        try {
          pending = JSON.parse(pending);
        } catch (_error) {
          pending = {};
        }
      }

      if (!pending.sellerMaskedId || !pending.catalogItemId) {
        await query(
          `
            UPDATE platform_users
            SET current_step = 'COMPLETED',
                pending_transport_payload = NULL,
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id]
        );
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Search context expired. Run search again.",
        });
      }

      const payload = await createOrderFromCatalogRequest({
        buyer: user,
        senderPhone,
        rawMessage: `search_select_${pending.catalogItemId}_${pending.sellerMaskedId}`,
        sellerMaskedId: pending.sellerMaskedId,
        quantity: qty,
        catalogItemId: pending.catalogItemId,
      });
      await notifySellerForLogisticsDecision({ payload });

      return respondToUser({
        res,
        provider,
        senderPhone,
        message:
          "Order sent to seller. Waiting stock + logistics confirmation before payment prompt.",
      });
    }

    if (user.current_step === "AWAITING_ORDER_CONFIRM") {
      const decision = rawMessage.trim();
      if (!["1", "2"].includes(decision)) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Reply 1 to deposit now or 2 to cancel order.",
        });
      }
      if (user.pending_order_id) {
        const pendingOrder = await query(
          `
            SELECT order_type, seller_logistics_mode, seller_stock_status
            FROM orders
            WHERE id = $1
              AND buyer_masked_id = $2
            LIMIT 1
          `,
          [user.pending_order_id, user.masked_id]
        );
        const order = pendingOrder.rows[0];
        if (
          order &&
          order.order_type === "SUPPLY" &&
          (order.seller_stock_status || "PENDING") !== "IN_STOCK"
        ) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message:
              "Seller has not confirmed stock yet. We will notify you once stock is confirmed.",
          });
        }
        if (
          order &&
          order.order_type === "SUPPLY" &&
          (order.seller_logistics_mode || "PENDING_SELLER_DECISION") ===
            "PENDING_SELLER_DECISION"
        ) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message:
              "Seller has not selected logistics yet. We will notify you once they choose own delivery or AgizaHub transporter.",
          });
        }
      }

      if (decision === "2") {
        await query(
          `
            UPDATE orders
            SET payment_status = 'PAYMENT_FAILED',
                settlement_status = 'ON_HOLD',
                distribution_status = 'ON_HOLD',
                dispute_reason = COALESCE(dispute_reason, 'Buyer cancelled before payment'),
                updated_at = NOW()
            WHERE id = $1
              AND buyer_masked_id = $2
          `,
          [user.pending_order_id, user.masked_id]
        );
        await query(
          `
            UPDATE platform_users
            SET current_step = 'COMPLETED',
                pending_order_id = NULL,
                pending_transport_payload = NULL,
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id]
        );
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Order cancelled successfully before payment.",
        });
      }

      const confirmed = await confirmPendingOrderPayment({ user, senderPhone });
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: confirmed.alreadyInitiated
          ? `Payment prompt already initiated for order #${confirmed.orderId}.`
          : `Confirmed. STK Push sent for KSh ${confirmed.totalAmountKes.toLocaleString()}.`,
      });
    }

    if (
      user.current_step === "TRANSPORT_CATEGORY" ||
      user.current_step === "TRANSPORT_PICKUP" ||
      user.current_step === "TRANSPORT_DROPOFF" ||
      user.current_step === "TRANSPORT_VEHICLE"
    ) {
      const response = await processTransportFlowStep({
        user,
        rawMessage,
        senderPhone,
      });
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: response,
      });
    }

    if (
      user.current_step === "AWAITING_SUPPLIER_STOCK_CONFIRM" ||
      user.current_step === "AWAITING_SUPPLIER_LOGISTICS_CHOICE" ||
      user.current_step === "AWAITING_SUPPLIER_VEHICLE_SELECTION"
    ) {
      const response = await processSupplierLogisticsStep({
        user,
        rawMessage,
      });
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: response,
      });
    }

    if (!user.user_type || user.current_step !== "COMPLETED") {
      const onboardingResponse = await processOnboardingStep({
        user,
        rawMessage,
        senderPhone,
      });
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: onboardingResponse,
      });
    }

    if (lowerMessage === "transport" || lowerMessage === "move") {
      await query(
        `
          UPDATE platform_users
          SET current_step = 'TRANSPORT_CATEGORY',
              pending_transport_payload = NULL,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: transportCategoryMenu(),
      });
    }

    if (lowerMessage === "buy" || lowerMessage === "offers" || lowerMessage === "view") {
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: await listCatalogOffersMessage(),
      });
    }

    if (
      user.user_type === "BUYER" &&
      (/^search\s+/i.test(rawMessage) || /^find\s+/i.test(rawMessage))
    ) {
      const searchTerm = rawMessage.replace(/^(search|find)\s+/i, "").trim();
      if (!searchTerm) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Use: search <product name>. Example: search maize flour",
        });
      }

      const rowsResult = await searchCatalogRows({
        searchTerm,
      });
      const rankedRows = rankSearchRowsForBuyer({
        rows: rowsResult.rows,
        buyer: user,
      });
      if (rankedRows.length === 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: `No active stock found for "${searchTerm}" right now.`,
        });
      }

      await query(
        `
          UPDATE platform_users
          SET current_step = 'AWAITING_SEARCH_SELECTION',
              pending_transport_payload = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          user.id,
          JSON.stringify({
            source: "buyer_search",
            searchTerm,
            options: rankedRows.slice(0, 10).map((row) => ({
              catalogItemId: row.catalog_item_id,
              sellerMaskedId: row.seller_masked_id,
            })),
          }),
        ]
      );

      return respondToUser({
        res,
        provider,
        senderPhone,
        message: buildSearchTextList({ searchTerm, rankedRows }),
        interactiveList: buildSearchInteractiveList({ searchTerm, rankedRows }),
      });
    }

    if (user.user_type === "SUPPLIER" && /^add\s+stock\s+/i.test(rawMessage)) {
      const parsedAdd = parseAddStockCommand(rawMessage);
      if (!parsedAdd || parsedAdd.quantity <= 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Use: Add stock <quantity> <item name>. Example: Add stock 50 Sugar",
        });
      }

      const updateResult = await query(
        `
          UPDATE catalog_items
          SET stock_quantity = stock_quantity + $3,
              updated_at = NOW()
          WHERE seller_masked_id = $1
            AND LOWER(commodity_name) LIKE CONCAT('%', LOWER($2), '%')
            AND is_active = TRUE
          RETURNING commodity_name, stock_quantity
        `,
        [user.masked_id, parsedAdd.commodity, parsedAdd.quantity]
      );

      if (updateResult.rowCount === 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            "Item not found in your catalog. Use 'Add new item: Item Name, Price 120, Stock 20' to create it.",
        });
      }

      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Inventory updated. ${updateResult.rows[0].commodity_name} now has ${Number(
          updateResult.rows[0].stock_quantity || 0
        ).toLocaleString()} units.`,
      });
    }

    if (
      user.user_type === "SUPPLIER" &&
      (/^add\s+new\s+item/i.test(rawMessage) || /^update\s+inventory/i.test(rawMessage))
    ) {
      const parsedNewItem = parseInventoryNewItemCommand(rawMessage);
      if (!parsedNewItem) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            "Use: Add new item: Premium Milk 1L, Price 150, Stock 20",
        });
      }

      const existingItem = await query(
        `
          SELECT id
          FROM catalog_items
          WHERE seller_masked_id = $1
            AND LOWER(commodity_name) = LOWER($2)
          LIMIT 1
        `,
        [user.masked_id, parsedNewItem.commodity]
      );

      if (existingItem.rowCount > 0) {
        await query(
          `
            UPDATE catalog_items
            SET price_per_unit = $2,
                stock_quantity = stock_quantity + $3,
                is_active = TRUE,
                updated_at = NOW()
            WHERE id = $1
          `,
          [existingItem.rows[0].id, Math.round(parsedNewItem.price), parsedNewItem.stockQuantity]
        );
      } else {
        await query(
          `
            INSERT INTO catalog_items (
              seller_masked_id,
              commodity_name,
              price_per_unit,
              stock_quantity,
              business_type,
              catalog_metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            user.masked_id,
            parsedNewItem.commodity,
            Math.round(parsedNewItem.price),
            parsedNewItem.stockQuantity,
            normalizeSupplierBusinessType(user.business_type),
            JSON.stringify({
              source: "supplier-add-new-item",
            }),
          ]
        );
      }

      return respondToUser({
        res,
        provider,
        senderPhone,
        message: "Inventory Updated! Your catalog has been adjusted successfully.",
      });
    }

    if (
      user.user_type === "SUPPLIER" &&
      (rawMessage.includes(",") || /^catalog\s+/i.test(rawMessage) || rawMessage.includes("\n"))
    ) {
      if (user.merchant_agreement_status !== "ACCEPTED") {
        await query(
          `
            UPDATE platform_users
            SET current_step = 'AWAITING_MERCHANT_AGREEMENT',
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id]
        );
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: merchantAgreementMessage(),
        });
      }
      const parsedCatalog = await parseAndNormalizeMerchantCatalog({
        rawMessage,
        merchantPhone: user.phone_number,
        businessTypeHint: user.business_type,
      });
      if (parsedCatalog.items.length > 0) {
        for (const item of parsedCatalog.items) {
          await query(
            `
              INSERT INTO catalog_items (
                seller_masked_id,
                commodity_name,
                price_per_unit,
                stock_quantity,
                business_type,
                catalog_metadata
              )
              VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [
              user.masked_id,
              item.commodity,
              item.pricePerUnitKes,
              Number(item.stockQuantity || 0),
              parsedCatalog.businessType,
              JSON.stringify(item.metadata),
            ]
          );
        }
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: `Added ${parsedCatalog.items.length} item(s) under ${parsedCatalog.businessType}.`,
        });
      }
    }

    if (user.user_type === "BUYER") {
      const buyMatch = rawMessage.match(/^buy\s+(\d{5})\s+(\d+(?:\.\d+)?)$/i);
      if (buyMatch) {
        const payload = await createOrderFromCatalogRequest({
          buyer: user,
          senderPhone,
          rawMessage,
          sellerMaskedId: buyMatch[1],
          quantity: Number(buyMatch[2]),
        });
        await notifySellerForLogisticsDecision({ payload });

        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            "Order submitted to seller successfully. Waiting seller stock confirmation, then logistics choice. You will receive checkout payment prompt once seller confirms both.",
        });
      }

      const refundMatch = rawMessage.match(/^refund\s+([a-zA-Z0-9-]+)(?:\s+(.+))?/i);
      if (refundMatch) {
        await requestOrderRefund({
          orderId: normalizeOrderIdFromText(refundMatch[1]),
          buyerMaskedId: user.masked_id,
          buyerPhone: senderPhone,
          reason: refundMatch[2] || null,
        });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Refund request logged. Funds locked pending admin decision.",
        });
      }
    }

    if (
      (user.user_type === "TRANSPORTER_BIKE" ||
        user.user_type === "TRANSPORTER_TRUCK") &&
      /^corridor\s+/i.test(rawMessage)
    ) {
      const corridor = rawMessage.replace(/^corridor\s+/i, "").trim().slice(0, 80);
      if (!corridor) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Use: corridor <town/area>. Example: corridor Nairobi Eastlands",
        });
      }
      await query(
        `
          UPDATE platform_users
          SET service_corridor_label = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, corridor]
      );
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Corridor updated to "${corridor}".`,
      });
    }

    if (
      (user.user_type === "TRANSPORTER_BIKE" ||
        user.user_type === "TRANSPORTER_TRUCK") &&
      /^vehicle\s+/i.test(rawMessage)
    ) {
      const choice = rawMessage.replace(/^vehicle\s+/i, "").trim();
      const vehicleType = parseVehicleType(choice);
      if (!vehicleType) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            "Use: vehicle 1|2|3 (1=MOTORBIKE, 2=TUKTUK_PICKUP, 3=CANTER_TRUCK)",
        });
      }
      await query(
        `
          UPDATE platform_users
          SET transporter_vehicle_type = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, vehicleType]
      );
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Vehicle profile updated to ${vehicleType}.`,
      });
    }

    if (
      (user.user_type === "TRANSPORTER_BIKE" ||
        user.user_type === "TRANSPORTER_TRUCK") &&
      (lowerMessage === "jobs" || lowerMessage === "open jobs")
    ) {
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: await listOpenTransportJobsForDriver({
          driverMaskedId: user.masked_id,
        }),
      });
    }

    if (
      (user.user_type === "TRANSPORTER_BIKE" ||
        user.user_type === "TRANSPORTER_TRUCK") &&
      /^claim\s+/i.test(rawMessage)
    ) {
      const claimMatch = rawMessage.match(/^claim\s+([a-zA-Z0-9-]+)/i);
      if (!claimMatch) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Use format: Claim <OrderID>",
        });
      }
      const claim = await claimTransportJobForDriver({
        orderId: normalizeOrderIdFromText(claimMatch[1]),
        driverMaskedId: user.masked_id,
      });
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Claimed #${claim.id}. Route: ${claim.pickup_location_label} -> ${claim.delivery_location}. Await payment + customer escrow code.`,
      });
    }

    if (
      (user.user_type === "TRANSPORTER_BIKE" ||
        user.user_type === "TRANSPORTER_TRUCK") &&
      /^deliver\s+/i.test(rawMessage)
    ) {
      const deliverMatch = rawMessage.match(
        /^deliver\s+([a-zA-Z0-9-]+)\s+((?:AGZ-\d{6})|\d{4})$/i
      );
      if (!deliverMatch) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Use format: Deliver <OrderID> <AGZ-123456>",
        });
      }
      await verifyOtpAndQueueRelease({
        orderId: normalizeOrderIdFromText(deliverMatch[1]),
        otp: deliverMatch[2].toUpperCase(),
      });
      return respondToUser({
        res,
        provider,
        senderPhone,
        message:
          "Escrow code verified. Order moved to AWAITING_RELEASE and sent to admin for final approval.",
      });
    }

    const legacyResult = await processLegacyAiOrder({
      rawMessage,
      senderPhone,
      senderName,
    });
    if (legacyResult.errorMessage) {
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: legacyResult.errorMessage,
      });
    }

    const { payload } = legacyResult;
    const stkResponse = await initiateStkPush({
      phoneNumber: senderPhone,
      amount: payload.order.total_amount_kes,
      accountReference: `ORD-${payload.order.id.slice(0, 8)}`,
      transactionDesc: `AgizaHub ${payload.inventory.vendor_name}`,
    });

    await query(
      `
        INSERT INTO mpesa_stk_transactions (
          order_id, checkout_request_id, merchant_request_id, amount_kes, msisdn, status, raw_response
        )
        VALUES ($1,$2,$3,$4,$5,'REQUESTED',$6)
      `,
      [
        payload.order.id,
        stkResponse.CheckoutRequestID,
        stkResponse.MerchantRequestID || null,
        payload.order.total_amount_kes,
        senderPhone,
        JSON.stringify(stkResponse),
      ]
    );
    await query(
      `UPDATE orders SET mpesa_checkout_request_id = $2, updated_at = NOW() WHERE id = $1`,
      [payload.order.id, stkResponse.CheckoutRequestID]
    );

    return respondToUser({
      res,
      provider,
      senderPhone,
      message: `Order ${payload.order.id.slice(0, 8)} imepokelewa. Lipa STK KES ${
        payload.order.total_amount_kes
      }. Escrow code: ${payload.otp}. Do NOT share until goods arrive and are verified.`,
    });
  } catch (error) {
    logger.error("WhatsApp inbound failed", { error: error.message });
    return next(error);
  }
};

module.exports = {
  handleIncomingWhatsapp,
};
