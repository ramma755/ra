const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { query, transaction } = require("../config/db");
const env = require("../config/env");
const {
  parseMarketplaceMessage,
  parseMerchantCatalogMessage,
  parseDisputeIntentMessage,
} = require("../services/aiParserService");
const { initiateStkPush, normalizeMsisdn, sendB2CPayment } = require("../services/darajaService");
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
const { extractCatalogTextFromInboundMedia } = require("../services/catalogIngestionService");
const { sendDisputeEscalationAlert } = require("../services/alertService");
const {
  registerSenderMessage,
  clearSenderBlocks,
  incrementSenderFailure,
} = require("../services/abusePreventionService");
const {
  issueAdminAccessToken,
  verifyAdminAccessToken,
  isAdminSessionActive,
  revokeAdminSession,
} = require("../services/adminTokenService");
const { queueOutboundMessage } = require("../services/outboundMessageQueueService");
const logger = require("../services/logger");
const MENUS = require("../menus");

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

const onboardingMenu = () => MENUS.ROLE_SELECT();

const paymentModeMenu = () => MENUS.PAYMENT_MODE();

const supplierBusinessTypeMenu = () => MENUS.SUPPLIER_BUSINESS_TYPE();

const sellerLogisticsChoiceMenu = () => MENUS.SELLER_LOGISTICS();

const sellerVehicleSelectionMenu = () => MENUS.SELLER_VEHICLE_SELECTION();

const sellerStockConfirmationMenu = ({ orderId }) => MENUS.SELLER_STOCK_CONFIRMATION(orderId);

const buyerDepositDecisionMenu = ({ orderId, totalAmountKes }) =>
  MENUS.BUYER_DEPOSIT_DECISION({ orderId, totalAmountKes });

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

const transportCategoryMenu = () => MENUS.TRANSPORT_CATEGORY();

const transportVehicleMenu = () => MENUS.TRANSPORT_VEHICLE();

const catalogIngestionMenu = () => MENUS.CATALOG_INGESTION();

const catalogIngestionInteractiveList = () => ({
  title: "AgizaHub Inventory Engine",
  body: "Choose your catalog update mode.",
  buttonText: "Select mode",
  sections: [
    {
      title: "Catalog ingestion options",
      rows: [
        {
          id: "catalog_mode_1",
          title: "Type Out Text",
          description: "Send item lines directly in chat",
        },
        {
          id: "catalog_mode_2",
          title: "Upload Document",
          description: "Upload Excel, Word, PDF, or CSV",
        },
        {
          id: "catalog_mode_3",
          title: "Snap a Photo",
          description: "Upload clear image of list/menu board",
        },
        {
          id: "catalog_mode_4",
          title: "Quick Inventory Top-Up",
          description: "Use Add stock or /update price command",
        },
        {
          id: "catalog_mode_5",
          title: "Guided Item Wizard",
          description: "Add item step-by-step: name, unit, price, stock",
        },
      ],
    },
  ],
});

const parseCatalogModeChoice = (rawMessage) => {
  const trimmed = String(rawMessage || "").trim();
  const rowMatch = trimmed.match(/^catalog_mode_([1-5])$/i);
  if (rowMatch) return rowMatch[1];
  const number = trimmed.match(/^([1-5])$/);
  if (number) return number[1];
  return null;
};

const helpCenterMenu = () => MENUS.HELP_CENTER();

const helpCenterInteractiveList = () => ({
  title: "AgizaHub Help Center",
  body: "Select an issue category to continue.",
  buttonText: "Choose issue",
  sections: [
    {
      title: "Support options",
      rows: [
        {
          id: "help_option_1",
          title: "Wrong Order Delivered",
          description: "Items delivered do not match what was ordered",
        },
        {
          id: "help_option_2",
          title: "No Delivery Code Sent",
          description: "Payment confirmed but delivery token missing",
        },
        {
          id: "help_option_3",
          title: "Transporter Delay",
          description: "Driver is unresponsive or heavily delayed",
        },
        {
          id: "help_option_4",
          title: "Payment / Refund Request",
          description: "Cancel escrow or request payment support",
        },
        {
          id: "help_option_5",
          title: "Talk to Human Admin",
          description: "Escalate this conversation to AgizaHub admin",
        },
      ],
    },
  ],
});

const locationCollectionPrompt = (label) =>
  `${label}\nTip: Share WhatsApp location pin (Attach -> Location) or send coordinates as latitude,longitude.`;

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

const parseHelpOption = (rawMessage) => {
  const trimmed = String(rawMessage || "").trim();
  const rowMatch = trimmed.match(/^help_option_(\d)$/i);
  if (rowMatch) return rowMatch[1];
  const numberMatch = trimmed.match(/^([1-5])$/);
  if (numberMatch) return numberMatch[1];
  return null;
};

const normalizeCatalogMetadata = (metadata) => {
  if (!metadata || typeof metadata !== "object") return {};
  return metadata;
};

const coerceCoordinates = ({ rawMessage, inboundLocation }) => {
  if (
    inboundLocation &&
    Number.isFinite(Number(inboundLocation.latitude)) &&
    Number.isFinite(Number(inboundLocation.longitude))
  ) {
    return {
      latitude: Number(Number(inboundLocation.latitude).toFixed(6)),
      longitude: Number(Number(inboundLocation.longitude).toFixed(6)),
      source: "whatsapp-location-pin",
    };
  }
  const parsed = parseCoordinates(rawMessage);
  if (parsed) {
    return {
      ...parsed,
      source: "text-coordinates",
    };
  }
  return null;
};

const buildGoogleMapsDirectionsLink = ({ originLat, originLng, destinationLat, destinationLng }) => {
  if (
    !Number.isFinite(Number(originLat)) ||
    !Number.isFinite(Number(originLng)) ||
    !Number.isFinite(Number(destinationLat)) ||
    !Number.isFinite(Number(destinationLng))
  ) {
    return null;
  }
  return `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destinationLat},${destinationLng}&travelmode=driving`;
};

const emotionalEscalationPattern =
  /(fraud|scam|police|court|lawyer|sue|angry|furious|stolen|threat|urgent|emergency|human admin|talk to admin)/i;

const adminTokenRequestPattern = /^(?:admin\s+(?:token|otp|login)|token)$/i;
const adminTokenVerifyPattern = /^(?:verify|code)\s+(\d{4})$/i;
const adminTokenPlainCodePattern = /^(\d{4})$/;
const adminLogoutPattern = /^(?:10|admin\s+logout|logout)$/i;
const adminUnmutePattern = /^(?:unmute|unban)\s+(\+?\d{9,15})$/i;
const adminBroadcastBuyersPattern = /^(?:broadcast\s+buyers|promo\s+buyers)\s+(.+)/i;
const adminBroadcastSellersPattern = /^(?:broadcast\s+sellers|promo\s+sellers)\s+(.+)/i;
const adminBroadcastAllPattern = /^(?:broadcast\s+all|promo\s+all)\s+(.+)/i;
const adminPayoutApprovePattern = /^(?:payout\s+approve)\s+(\d+)$/i;
const adminRevenuePattern = /^(?:revenue|dashboard)(?:\s+today)?$/i;
const adminOverrideOrderPattern =
  /^(?:override|force\s+set)\s+([a-zA-Z0-9-]+)\s+(payment_status|settlement_status|distribution_status|order_progress_status)\s+([A-Z_]+)$/i;
const adminForceRefundPattern = /^(?:force\s+refund)\s+([a-zA-Z0-9-]+)$/i;
const adminCloseOrderPattern = /^(?:close\s+order|force\s+close)\s+([a-zA-Z0-9-]+)$/i;
const adminSetTierPattern = /^(?:set\s+tier)\s+(\d{5})\s+(free|premium)$/i;
const adminAcknowledgeText = () =>
  `Admin acknowledged: ${env.admin.name}. I am ready to execute privileged commands.`;
const adminCommandMenu = () => MENUS.ADMIN_MENU();
const adminPendingActions = new Map();
const ADMIN_PENDING_ACTION_TTL_MS = 10 * 60 * 1000;
const adminExplicitCommandPattern =
  /^(?:release|hold|approve|reject|unmute|unban|payout\s+approve|payout\s+reject|revenue|dashboard|override|force\s+refund|close\s+order|force\s+close|set\s+tier|broadcast\s+buyers|broadcast\s+sellers|broadcast\s+all|promo\s+buyers|promo\s+sellers|promo\s+all)\b/i;

const setAdminPendingAction = ({ senderPhone, actionType }) => {
  adminPendingActions.set(senderPhone, {
    actionType,
    createdAt: Date.now(),
  });
};

const clearAdminPendingAction = ({ senderPhone }) => {
  adminPendingActions.delete(senderPhone);
};

const getAdminPendingAction = ({ senderPhone }) => {
  const state = adminPendingActions.get(senderPhone);
  if (!state) return null;
  if (Date.now() - Number(state.createdAt || 0) > ADMIN_PENDING_ACTION_TTL_MS) {
    adminPendingActions.delete(senderPhone);
    return null;
  }
  return state;
};

const isExplicitAdminCommand = (input) => adminExplicitCommandPattern.test(String(input || "").trim());
const looksLikeOrderId = (input) => /^[a-zA-Z0-9-]{6,}$/.test(String(input || "").trim());

const normalizeIncomingMessageText = (value) =>
  String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);

const merchantAgreementAcceptPattern = /^(?:i\s+agree|nakubali(?:\s+masharti)?)$/i;
const termsCommandPattern = /^(?:terms|masharti|vigezo|kanuni)$/i;
const supportOrderPattern = /^(?:support|msaada|tiketi)\s+([a-zA-Z0-9-]+)/i;
const helpCommandPattern = /^(?:\/?help|\/?msaada|nisaidie|saidia|help\s+me)$/i;
const transportCommandPattern = /^(?:transport|move|hama|safirisha)$/i;
const buyOffersViewPattern = /^(?:buy|offers|view|nunua|onyesha|bidhaa|orodha)$/i;
const searchCommandPrefixPattern = /^(?:search|find|tafuta|tafta|nitafutie)\s+/i;
const searchOnlyPattern = /^(?:search|find|tafuta|tafta|nitafutie)$/i;
const supplierBuyPattern = /^(?:buy|nunua|agiza)\s+(\d{5})\s+(.+)$/i;
const buyByItemPattern = /^(?:buy|nunua|agiza)\s+(?:item\s+)?(\d+)\s+(.+)$/i;
const refundPattern = /^(?:refund|rejesha|rudisha)\s+([a-zA-Z0-9-]+)(?:\s+(.+))?/i;
const addStockPrefixPattern = /^(?:add\s+stock|ongeza\s+(?:stock|hisa|stoo))\s+/i;
const addOrUpdateInventoryPattern =
  /^(?:add\s+new\s+item|update\s+inventory|ongeza\s+bidhaa\s+mpya|sasisha\s+(?:inventory|orodha))/i;
const sellerItemWizardStartPattern =
  /^(?:catalog\s+wizard|add\s+item|add\s+catalog|ongeza\s+item|ongeza\s+catalog)$/i;
const priceUpdatePrefixPattern =
  /^(?:\/?update\s+price|badili\s+bei|weka\s+bei|sahihisha\s+bei)\b/i;
const listPricesPattern =
  /^(?:\/?(?:my\s+prices|list\s+prices|price\s+list|my\s+catalog)|bei\s+zangu|orodha\s+ya\s+bei)$/i;
const corridorPattern = /^(?:corridor|eneo)\s+(.+)$/i;
const vehiclePattern = /^(?:vehicle|gari)\s+(.+)$/i;
const jobsPattern = /^(?:jobs|open\s+jobs|kazi|kazi\s+wazi)$/i;
const claimPattern = /^(?:claim|chukua)\s+([a-zA-Z0-9-]+)/i;
const deliverPattern = /^(?:deliver|wasilisha)\s+([a-zA-Z0-9-]+)\s+((?:AGZ-\d{6})|\d{4})$/i;
const supplierCatalogTriggerPattern =
  /^(?:update(\s+my)?\s+(items|catalog|catalogue|stock)|add\s+(catalog|catalogue)|catalog(\s+update)?|sasisha\s+(?:bidhaa|catalog|catalogue|stock)|ongeza\s+(?:bidhaa|catalog|catalogue|stock))$/i;
const categoriesPattern = /^(?:categories|category|menu|departments|idara|kategoria)$/i;
const categorySelectPattern = /^(?:category|idara)\s+(.+)$/i;
const comparePattern = /^(?:compare|linganisha)\s+(.+)$/i;
const detailPattern = /^(?:detail|details|maelezo)\s+(\d+)$/i;
const wishlistAddPattern = /^(?:wishlist\s+add|fav|favourite|ongeza\s+penda)\s+(\d+)$/i;
const wishlistRemovePattern = /^(?:wishlist\s+remove|remove\s+fav|ondoa\s+penda)\s+(\d+)$/i;
const wishlistListPattern = /^(?:wishlist|favourites|favorites|penda|vipendwa)$/i;
const cartAddPattern = /^(?:cart\s+add|ongeza\s+cart)\s+(\d+)\s+(\d+(?:\.\d+)?)$/i;
const cartViewPattern = /^(?:cart|view\s+cart|cart\s+view|kikapu)$/i;
const cartClearPattern = /^(?:cart\s+clear|futa\s+cart)$/i;
const cartCheckoutPattern = /^(?:checkout|checkout\s+cart|lipa)$/i;
const reorderPattern = /^(?:reorder|repeat\s+last\s+order|agiza\s+tena)$/i;
const statusPattern = /^(?:status|order\s+status|hali)(?:\s+([a-zA-Z0-9-]+))?$/i;
const packedPattern = /^(?:packed|imefungwa)\s+([a-zA-Z0-9-]+)$/i;
const enRoutePattern = /^(?:enroute|onroute|njiani)\s+([a-zA-Z0-9-]+)$/i;
const ratePattern = /^(?:rate|rating|kadiria)\s+([a-zA-Z0-9-]+)\s+([1-5])(?:\s+(.+))?$/i;
const pointsPattern = /^(?:points|loyalty|pointi)$/i;
const referralCodePattern = /^(?:my\s+referral|referral\s+code|mwaliko)$/i;
const referralApplyPattern = /^(?:refer|invite|tumia\s+ref)\s+([a-zA-Z0-9]{4,20})$/i;
const restockAlertPattern = /^(?:alert\s+me|notify\s+me|niambie)\s+(\d+)$/i;
const languagePattern = /^(?:language|lugha)\s+(english|en|swahili|sw)$/i;
const setAddressPattern = /^(?:set\s+address|weka\s+address)\s+(.+)$/i;
const myAddressPattern = /^(?:my\s+address|address|anwani)$/i;
const schedulePattern = /^(?:schedule|preorder|agiza\s+baadaye)\s+([a-zA-Z0-9-]+)\s+(.+)$/i;
const payoutRequestPattern = /^(?:payout\s+request|withdraw|toa\s+pesa)\s+(\d+(?:\.\d+)?)$/i;
const deleteItemPattern = /^(?:delete\s+item|remove\s+item|futa\s+item)\s+(\d+)$/i;
const updateStockThresholdPattern = /^(?:lowstock|stock\s+threshold|kizingiti)\s+(\d+)\s+(\d+)$/i;
const flashSalePattern = /^(?:flash\s+sale)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+)$/i;
const promoteItemPattern = /^(?:promote\s+item)\s+(\d+)\s+(\d+)$/i;

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
    .match(/^(?:add\s+stock|ongeza\s+(?:stock|hisa|stoo))\s+(\d+)\s+(.+)$/i);
  if (!match) return null;
  return {
    quantity: Number(match[1]),
    commodity: match[2].trim().slice(0, 50),
  };
};

const parseInventoryNewItemCommand = (rawMessage) => {
  const cleaned = String(rawMessage || "")
    .trim()
    .replace(/^(?:add\s+new\s+item|ongeza\s+bidhaa\s+mpya)\s*:\s*/i, "")
    .replace(/^(?:update\s+inventory|sasisha\s+(?:inventory|orodha))\s*:\s*/i, "")
    .replace(/^(?:update\s+inventory|sasisha\s+(?:inventory|orodha))\s+/i, "");
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

const parseUpdatePriceCommand = (rawMessage) => {
  const match = String(rawMessage || "")
    .trim()
    .match(/^(?:\/?update\s+price|badili\s+bei|weka\s+bei|sahihisha\s+bei)\s+(\d+)\s+(\d+(?:\.\d+)?)$/i);
  if (!match) return null;
  const catalogItemId = Number(match[1]);
  const newPrice = Number(match[2]);
  if (!Number.isFinite(catalogItemId) || catalogItemId <= 0) return null;
  if (!Number.isFinite(newPrice) || newPrice <= 0) return null;
  return {
    catalogItemId,
    newPrice: Math.round(newPrice),
  };
};

const parseFlexibleQuantity = (rawValue) => {
  const input = String(rawValue || "")
    .trim()
    .toLowerCase()
    .replace(/,/g, ".");
  if (!input) return Number.NaN;

  const mixed = input.match(/^(\d+)\s*(?:and|na)\s*(\d+)\s*\/\s*(\d+)$/i);
  if (mixed) {
    const whole = Number(mixed[1]);
    const top = Number(mixed[2]);
    const bottom = Number(mixed[3]);
    if (bottom > 0) return whole + top / bottom;
  }

  const spacedMixed = input.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (spacedMixed) {
    const whole = Number(spacedMixed[1]);
    const top = Number(spacedMixed[2]);
    const bottom = Number(spacedMixed[3]);
    if (bottom > 0) return whole + top / bottom;
  }

  const fraction = input.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const top = Number(fraction[1]);
    const bottom = Number(fraction[2]);
    if (bottom > 0) return top / bottom;
  }

  const numeric = Number(input);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
};

const MARKET_CATEGORY_RULES = [
  { name: "CEREALS_GRAINS", keywords: ["maize", "unga", "flour", "rice", "beans", "lentil", "wheat", "sugar"] },
  { name: "FOOD_GROCERY", keywords: ["tomato", "onion", "milk", "egg", "oil", "fruit", "vegetable", "bread"] },
  { name: "ELECTRONICS_GADGETS", keywords: ["charger", "phone", "cable", "laptop", "earbuds", "tv", "screen"] },
  { name: "CLOTHES_SHOES", keywords: ["shoe", "shirt", "dress", "trouser", "jacket", "sneaker", "heels"] },
  { name: "FURNITURE_HOME", keywords: ["sofa", "table", "chair", "bed", "mattress", "wardrobe", "desk"] },
  { name: "AUTO_MOTO_PARTS_REPAIR", keywords: ["tyre", "battery", "brake", "engine", "car", "bike", "repair"] },
  { name: "HARDWARE_CONSTRUCTION", keywords: ["cement", "paint", "nail", "pipe", "wire", "tile", "timber"] },
  { name: "BEAUTY_PERSONAL_CARE", keywords: ["soap", "lotion", "cream", "shampoo", "perfume", "makeup"] },
];

const inferMarketplaceCategory = (name) => {
  const text = String(name || "").toLowerCase();
  for (const rule of MARKET_CATEGORY_RULES) {
    if (rule.keywords.some((k) => text.includes(k))) return rule.name;
  }
  return "GENERAL_MERCHANDISE";
};

const formatUserStepLabel = (currentStep) => {
  const step = String(currentStep || "START").trim().toUpperCase();
  if (step === "COMPLETED") return "ACTIVE";
  if (step.startsWith("AWAITING_")) return `SETUP_IN_PROGRESS (${step.replace("AWAITING_", "")})`;
  return step;
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

const generateRegistrationOtp = async () => {
  const otp = crypto.randomInt(0, 10000).toString().padStart(4, "0");
  const otpHash = await bcrypt.hash(otp, 10);
  return { otp, otpHash };
};

const parseAndNormalizeMerchantCatalog = async ({
  rawMessage,
  merchantPhone,
  businessTypeHint,
}) => {
  const cleanedInput = String(rawMessage || "")
    .replace(/^(?:catalog|catalogue|orodha)\s+/i, "")
    .trim();
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

const upsertSupplierCatalogItemsFromParsed = async ({
  supplierUser,
  parsedCatalog,
  sourceTag,
  client: txClient = null,
}) => {
  const run = async (client) => {
    const businessType = normalizeSupplierBusinessType(
      parsedCatalog.businessType || supplierUser.business_type
    );
    let created = 0;
    let updated = 0;

    for (const item of parsedCatalog.items || []) {
      const commodity = String(item.commodity || "").trim().slice(0, 50);
      const price = Number(item.pricePerUnitKes);
      if (!commodity || !Number.isFinite(price) || price <= 0) continue;

      const stockProvided = Number.isFinite(Number(item.stockQuantity));
      const stockValue = stockProvided ? Math.max(0, Number(item.stockQuantity)) : null;
      const normalizedMetadata = normalizeCatalogMetadata(item.metadata) || {};
      const metadata = {
        ...normalizedMetadata,
        product_category:
          String(normalizedMetadata.product_category || "").trim() ||
          inferMarketplaceCategory(commodity),
        source: sourceTag || "catalog-ingestion",
        ingested_at: new Date().toISOString(),
      };

      const existing = await client.query(
        `
          SELECT id
          FROM catalog_items
          WHERE seller_masked_id = $1
            AND LOWER(commodity_name) = LOWER($2)
          LIMIT 1
          FOR UPDATE
        `,
        [supplierUser.masked_id, commodity]
      );

      if (existing.rowCount > 0) {
        await client.query(
          `
            UPDATE catalog_items
            SET price_per_unit = $2,
                stock_quantity = CASE WHEN $3::int IS NULL THEN stock_quantity ELSE $3 END,
                business_type = $4,
                catalog_metadata = COALESCE(catalog_metadata, '{}'::jsonb) || $5::jsonb,
                is_active = TRUE,
                updated_at = NOW()
            WHERE id = $1
          `,
          [existing.rows[0].id, Math.round(price), stockValue, businessType, JSON.stringify(metadata)]
        );
        updated += 1;
      } else {
        await client.query(
          `
            INSERT INTO catalog_items (
              seller_masked_id,
              commodity_name,
              price_per_unit,
              stock_quantity,
              business_type,
              catalog_metadata,
              is_active,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW(), NOW())
          `,
          [
            supplierUser.masked_id,
            commodity,
            Math.round(price),
            stockValue == null ? 100 : stockValue,
            businessType,
            JSON.stringify(metadata),
          ]
        );
        created += 1;
      }
    }

    await client.query(
      `
        UPDATE platform_users
        SET business_type = COALESCE($2, business_type),
            current_step = 'COMPLETED',
            updated_at = NOW()
        WHERE id = $1
      `,
      [supplierUser.id, businessType]
    );

    return {
      created,
      updated,
      businessType,
      total: created + updated,
    };
  };
  if (txClient) {
    return run(txClient);
  }
  return transaction(run);
};

const processSupplierCatalogIngestionStep = async ({
  user,
  rawMessage,
  senderPhone,
  inboundMedia,
}) => {
  const trimmed = String(rawMessage || "").trim();

  if (user.current_step === "AWAITING_CATALOG_INGESTION_MODE") {
    const choice = parseCatalogModeChoice(trimmed);
    if (!choice) {
      return {
        message: catalogIngestionMenu(),
        interactiveList: catalogIngestionInteractiveList(),
      };
    }

    if (choice === "1") {
      await query(
        `
          UPDATE platform_users
          SET current_step = 'AWAITING_CATALOG_TEXT_BULK',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return {
        message:
          "Send catalog lines in text (one per line), e.g.:\nTomatoes, 120\nOnions, 150\nYou can include stock as third value: Onions, 150, 80",
      };
    }

    if (choice === "2") {
      await query(
        `
          UPDATE platform_users
          SET current_step = 'AWAITING_CATALOG_DOCUMENT',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return {
        message:
          "Upload your document now (.xlsx/.xls/.csv/.docx/.doc/.pdf). No in-bot size cap is enforced by AgizaHub parser.",
      };
    }

    if (choice === "3") {
      await query(
        `
          UPDATE platform_users
          SET current_step = 'AWAITING_CATALOG_IMAGE',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return {
        message:
          "Upload a clear image of your menu/price list/delivery note. The bot will extract and normalize items automatically.",
      };
    }

    if (choice === "4") {
      await query(
        `
          UPDATE platform_users
          SET current_step = 'COMPLETED',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return {
        message:
          "Quick top-up mode enabled. Use:\n- Add stock 50 Sugar\n- /update price 2 340\n- Add new item: Premium Milk 1L, Price 150, Stock 20",
      };
    }

    await query(
      `
        UPDATE platform_users
        SET current_step = 'AWAITING_SELLER_ITEM_NAME',
            pending_transport_payload = $2::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        user.id,
        JSON.stringify({
          source: "seller-item-wizard",
          itemsAdded: 0,
        }),
      ]
    );
    return {
      message:
        "Guided Item Wizard started.\nStep 1/4: Send product name.\nExample: Maize Flour 2kg",
    };
  }

  if (user.current_step === "AWAITING_CATALOG_TEXT_BULK") {
    if (["cancel", "0"].includes(trimmed.toLowerCase())) {
      await query(
        `
          UPDATE platform_users
          SET current_step = 'COMPLETED',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return { message: "Catalog update cancelled." };
    }

    const parsedCatalog = await parseAndNormalizeMerchantCatalog({
      rawMessage: trimmed,
      merchantPhone: user.phone_number,
      businessTypeHint: user.business_type,
    });
    if (!parsedCatalog.items.length) {
      return {
        message:
          "No valid catalog lines detected. Please resend in format: Product, Price[, Stock]",
      };
    }
    const summary = await upsertSupplierCatalogItemsFromParsed({
      supplierUser: user,
      parsedCatalog,
      sourceTag: "text-manual-ingestion",
    });
    return {
      message: `Catalog synced successfully. Added ${summary.created}, updated ${summary.updated} (${summary.businessType}).`,
    };
  }

  if (
    user.current_step === "AWAITING_CATALOG_DOCUMENT" ||
    user.current_step === "AWAITING_CATALOG_IMAGE"
  ) {
    if (!inboundMedia?.url) {
      return {
        message:
          user.current_step === "AWAITING_CATALOG_DOCUMENT"
            ? "Please upload a document file (Excel/Word/PDF/CSV)."
            : "Please upload an image file (photo of list/menu board).",
      };
    }

    try {
      const extracted = await extractCatalogTextFromInboundMedia({
        media: inboundMedia,
      });
      if (
        user.current_step === "AWAITING_CATALOG_IMAGE" &&
        extracted.mediaKind !== "image"
      ) {
        return {
          message:
            "That upload is not an image. Please send a photo (jpg/png/webp) or choose document mode.",
        };
      }
      if (
        user.current_step === "AWAITING_CATALOG_DOCUMENT" &&
        extracted.mediaKind === "image"
      ) {
        return {
          message:
            "Image detected. Please choose option 3 for photo mode, or upload an Excel/Word/PDF/CSV file.",
        };
      }

      const parsedCatalog = await parseAndNormalizeMerchantCatalog({
        rawMessage: extracted.extractedText,
        merchantPhone: user.phone_number,
        businessTypeHint: user.business_type,
      });
      if (!parsedCatalog.items.length) {
        return {
          message:
            "Upload parsed but no catalog rows were recognized. Try clearer file formatting or send text lines directly.",
        };
      }

      const summary = await upsertSupplierCatalogItemsFromParsed({
        supplierUser: user,
        parsedCatalog,
        sourceTag: `upload-${extracted.mediaKind}`,
      });

      return {
        message: `Upload processed (${extracted.mediaKind}). Added ${summary.created}, updated ${summary.updated} items (${summary.businessType}).`,
      };
    } catch (error) {
      logger.warn("Catalog media ingestion failed", {
        userId: user.id,
        error: error.message,
      });
      return {
        message: `Upload processing failed: ${error.message}`,
      };
    }
  }

  return null;
};

const parseWizardPayload = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return {};
  }
};

const startSupplierItemWizard = async ({ user }) => {
  await query(
    `
      UPDATE platform_users
      SET current_step = 'AWAITING_SELLER_ITEM_NAME',
          pending_transport_payload = $2::jsonb,
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      user.id,
      JSON.stringify({
        source: "seller-item-wizard",
        itemsAdded: 0,
      }),
    ]
  );
  return [
    "Catalog Wizard started ✅",
    "Step 1/4: Send product name.",
    "Example: USB-C Charger 20W",
    "Type cancel to stop.",
  ].join("\n");
};

const saveWizardCatalogItem = async ({
  user,
  senderPhone,
  itemName,
  unitMeasure,
  priceKes,
  stockQuantity,
}) => {
  const productCategory = inferMarketplaceCategory(itemName);
  const metadata = {
    source: "seller-item-wizard",
    product_category: productCategory,
    updated_by_phone: senderPhone,
    updated_at: new Date().toISOString(),
  };

  const existing = await query(
    `
      SELECT id
      FROM catalog_items
      WHERE seller_masked_id = $1
        AND LOWER(commodity_name) = LOWER($2)
      LIMIT 1
    `,
    [user.masked_id, itemName]
  );

  if (existing.rowCount > 0) {
    const updated = await query(
      `
        UPDATE catalog_items
        SET price_per_unit = $2,
            unit_measure = $3,
            stock_quantity = $4,
            business_type = $5,
            catalog_metadata = COALESCE(catalog_metadata, '{}'::jsonb) || $6::jsonb,
            is_active = TRUE,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `,
      [
        existing.rows[0].id,
        Math.round(priceKes),
        unitMeasure,
        stockQuantity,
        normalizeSupplierBusinessType(user.business_type),
        JSON.stringify(metadata),
      ]
    );
    return { catalogItemId: Number(updated.rows[0].id), mode: "updated", productCategory };
  }

  const inserted = await query(
    `
      INSERT INTO catalog_items (
        seller_masked_id,
        commodity_name,
        price_per_unit,
        unit_measure,
        stock_quantity,
        business_type,
        catalog_metadata,
        is_active,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, TRUE, NOW(), NOW())
      RETURNING id
    `,
    [
      user.masked_id,
      itemName,
      Math.round(priceKes),
      unitMeasure,
      stockQuantity,
      normalizeSupplierBusinessType(user.business_type),
      JSON.stringify(metadata),
    ]
  );
  return { catalogItemId: Number(inserted.rows[0].id), mode: "created", productCategory };
};

const processSupplierItemWizardStep = async ({ user, rawMessage, senderPhone }) => {
  const trimmed = String(rawMessage || "").trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return "Please send a value to continue.";

  if (["cancel", "back", "acha", "sitisha"].includes(lower)) {
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
    return "Catalog wizard cancelled.";
  }

  const payload = parseWizardPayload(user.pending_transport_payload);
  if (payload.source !== "seller-item-wizard") {
    payload.source = "seller-item-wizard";
    payload.itemsAdded = Number(payload.itemsAdded || 0);
  }

  if (user.current_step === "AWAITING_SELLER_ITEM_NAME") {
    const name = trimmed.slice(0, 50);
    if (name.length < 2) return "Product name too short. Example: Maize Flour 2kg";
    await query(
      `
        UPDATE platform_users
        SET current_step = 'AWAITING_SELLER_ITEM_UNIT',
            pending_transport_payload = $2::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        user.id,
        JSON.stringify({
          ...payload,
          itemName: name,
          productCategory: inferMarketplaceCategory(name),
        }),
      ]
    );
    return [
      `Step 2/4: Send unit/pack size for "${name}".`,
      "Examples: 1kg, 1/2kg, 1/4kg, 1ltr, piece, pair, 2kg",
    ].join("\n");
  }

  if (user.current_step === "AWAITING_SELLER_ITEM_UNIT") {
    const unit = trimmed.slice(0, 20);
    await query(
      `
        UPDATE platform_users
        SET current_step = 'AWAITING_SELLER_ITEM_PRICE',
            pending_transport_payload = $2::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        user.id,
        JSON.stringify({
          ...payload,
          unitMeasure: unit,
        }),
      ]
    );
    return `Step 3/4: Send price in KSh for one ${unit}. Example: 180`;
  }

  if (user.current_step === "AWAITING_SELLER_ITEM_PRICE") {
    const price = Number(trimmed.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(price) || price <= 0) {
      return "Invalid price. Send a number only. Example: 180";
    }
    await query(
      `
        UPDATE platform_users
        SET current_step = 'AWAITING_SELLER_ITEM_STOCK',
            pending_transport_payload = $2::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        user.id,
        JSON.stringify({
          ...payload,
          priceKes: Math.round(price),
        }),
      ]
    );
    return "Step 4/4: Send current stock quantity (number of units available). Example: 40";
  }

  if (user.current_step === "AWAITING_SELLER_ITEM_STOCK") {
    const stock = Number(trimmed.replace(/[^\d]/g, ""));
    if (!Number.isFinite(stock) || stock < 0) {
      return "Invalid stock quantity. Send a whole number. Example: 40";
    }
    const itemName = String(payload.itemName || "").trim();
    const unitMeasure = String(payload.unitMeasure || "").trim() || "unit";
    const priceKes = Number(payload.priceKes || 0);
    if (!itemName || !Number.isFinite(priceKes) || priceKes <= 0) {
      return "Wizard context expired. Type 'catalog wizard' to restart.";
    }

    const saved = await saveWizardCatalogItem({
      user,
      senderPhone,
      itemName,
      unitMeasure,
      priceKes,
      stockQuantity: stock,
    });

    const nextPayload = {
      source: "seller-item-wizard",
      itemsAdded: Number(payload.itemsAdded || 0) + 1,
      lastItemId: saved.catalogItemId,
      lastItemName: itemName,
    };
    await query(
      `
        UPDATE platform_users
        SET current_step = 'AWAITING_SELLER_ITEM_CONTINUE',
            pending_transport_payload = $2::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
      [user.id, JSON.stringify(nextPayload)]
    );

    return [
      `Saved (${saved.mode}) ✅ ID ${saved.catalogItemId}: ${itemName}`,
      `Category: ${saved.productCategory.replace(/_/g, " ")}`,
      "Reply 1 to add next product, or 2 to finish and view full catalog table.",
    ].join("\n");
  }

  if (user.current_step === "AWAITING_SELLER_ITEM_CONTINUE") {
    if (["1", "yes", "next", "endelea"].includes(lower)) {
      await query(
        `
          UPDATE platform_users
          SET current_step = 'AWAITING_SELLER_ITEM_NAME',
              pending_transport_payload = $2::jsonb,
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          user.id,
          JSON.stringify({
            source: "seller-item-wizard",
            itemsAdded: Number(payload.itemsAdded || 0),
          }),
        ]
      );
      return "Step 1/4: Send next product name.";
    }

    if (["2", "done", "finish", "no", "hapana"].includes(lower)) {
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
      const table = await listSupplierCatalogPricesMessage({
        sellerMaskedId: user.masked_id,
      });
      return [
        `Catalog wizard complete. Items captured: ${Number(payload.itemsAdded || 0)}.`,
        "",
        table,
      ].join("\n");
    }
    return "Reply 1 to add next product, or 2 to finish.";
  }

  return null;
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

const trimForTable = (value, maxLen) => {
  const text = String(value || "");
  if (text.length <= maxLen) return text.padEnd(maxLen, " ");
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
};

const renderTextTable = ({ headers, rows, widths }) => {
  const formatRow = (cols) =>
    cols
      .map((col, idx) => trimForTable(col, widths[idx]))
      .join(" | ")
      .trimEnd();
  const divider = widths.map((w) => "-".repeat(w)).join("-+-");
  const lines = [formatRow(headers), divider];
  rows.forEach((row) => lines.push(formatRow(row)));
  return ["```", ...lines, "```"].join("\n");
};

const listCatalogOffersMessage = async () => {
  const result = await query(
    `
      SELECT
        c.id AS catalog_item_id,
        c.commodity_name,
        c.price_per_unit,
        c.flash_discount_percent,
        c.flash_discount_ends_at,
        c.bulk_discount_tiers,
        c.promoted_until,
        c.unit_measure,
        c.location_label,
        c.business_type,
        c.catalog_metadata,
        c.stock_quantity,
        u.masked_id,
        u.company_name,
        u.seller_tier,
        u.hub_latitude,
        u.hub_longitude
      FROM catalog_items c
      JOIN platform_users u ON u.masked_id = c.seller_masked_id
      WHERE c.is_active = TRUE
        AND c.stock_quantity > 0
        AND u.user_type = 'SUPPLIER'
        AND COALESCE(u.merchant_agreement_status, 'PENDING') = 'ACCEPTED'
      ORDER BY
        CASE WHEN c.promoted_until IS NOT NULL AND c.promoted_until > NOW() THEN 0 ELSE 1 END ASC,
        CASE WHEN COALESCE(u.seller_tier, 'FREE') = 'PREMIUM' THEN 0 ELSE 1 END ASC,
        c.price_per_unit ASC,
        c.created_at ASC
      LIMIT 15
    `
  );

  if (result.rowCount === 0) {
    return "Hakuna offers kwa sasa. Suppliers wanapakia stock hivi karibuni.";
  }

  const rows = [];
  const hints = [];
  for (const item of result.rows.slice(0, 12)) {
    const effectivePrice = resolveEffectiveUnitPrice({
      basePrice: Number(item.price_per_unit || 0),
      quantity: 1,
      flashDiscountPercent: Number(item.flash_discount_percent || 0),
      flashDiscountEndsAt: item.flash_discount_ends_at,
      bulkDiscountTiers: item.bulk_discount_tiers,
    });
    const category =
      item.catalog_metadata?.product_category ||
      inferMarketplaceCategory(item.commodity_name || item.business_type);
    rows.push([
      String(item.catalog_item_id),
      item.commodity_name || "Item",
      item.unit_measure || "unit",
      Number(effectivePrice || 0).toLocaleString(),
      Number(item.stock_quantity || 0).toLocaleString(),
      category.replace(/_/g, " ").slice(0, 10),
    ]);
    hints.push(
      `#${item.catalog_item_id} by ${item.company_name || `Seller #${item.masked_id}`} (seller #${item.masked_id})`
    );
  }
  return [
    "Available Offers (easy view)",
    renderTextTable({
      headers: ["ID", "PRODUCT", "UNIT", "PRICE", "STOCK", "CATEGORY"],
      widths: [4, 18, 8, 8, 7, 10],
      rows,
    }),
    "Buy using: buy item <ID> <qty>  (example: buy item 12 1.5)",
    "Search using: search <product>  (example: search charger)",
    "",
    "Seller references:",
    ...hints,
  ].join("\n");
};

const listCategoriesMessage = async () => {
  const result = await query(
    `
      SELECT business_type, COUNT(*) AS item_count
      FROM catalog_items
      WHERE is_active = TRUE
        AND stock_quantity > 0
      GROUP BY business_type
      ORDER BY business_type ASC
    `
  );
  if (result.rowCount === 0) {
    return "No active categories available right now.";
  }
  const mapping = {
    WHOLESALE: "Wholesale",
    RETAILER: "Retail",
    RESTAURANT: "Restaurant",
    GENERAL_SERVICES: "General Services",
  };
  const lines = ["Browse categories (reply with: category <number>):"];
  result.rows.forEach((row, idx) => {
    lines.push(`${idx + 1}. ${mapping[row.business_type] || row.business_type} (${row.item_count} items)`);
  });
  return lines.join("\n");
};

const resolveCategoryType = async (input) => {
  const value = String(input || "").trim();
  const byNumber = Number(value);
  const categories = ["WHOLESALE", "RETAILER", "RESTAURANT", "GENERAL_SERVICES"];
  if (Number.isInteger(byNumber) && byNumber >= 1 && byNumber <= categories.length) {
    return categories[byNumber - 1];
  }
  const upper = value.toUpperCase().replace(/\s+/g, "_");
  if (categories.includes(upper)) return upper;
  if (upper === "GENERAL") return "GENERAL_SERVICES";
  return null;
};

const listCatalogByCategoryMessage = async ({ categoryType }) => {
  const result = await query(
    `
      SELECT
        c.id AS catalog_item_id,
        c.commodity_name,
        c.price_per_unit,
        c.flash_discount_percent,
        c.flash_discount_ends_at,
        c.bulk_discount_tiers,
        c.promoted_until,
        c.stock_quantity,
        c.unit_measure,
        u.masked_id,
        u.company_name,
        COALESCE(u.merchant_agreement_status, 'PENDING') AS merchant_agreement_status,
        COALESCE(u.seller_tier, 'FREE') AS seller_tier
      FROM catalog_items c
      JOIN platform_users u ON u.masked_id = c.seller_masked_id
      WHERE c.is_active = TRUE
        AND c.stock_quantity > 0
        AND c.business_type = $1
        AND u.user_type = 'SUPPLIER'
      ORDER BY
        CASE WHEN c.promoted_until IS NOT NULL AND c.promoted_until > NOW() THEN 0 ELSE 1 END ASC,
        CASE WHEN COALESCE(u.seller_tier, 'FREE') = 'PREMIUM' THEN 0 ELSE 1 END ASC,
        c.price_per_unit ASC,
        c.updated_at DESC
      LIMIT 20
    `,
    [categoryType]
  );
  if (result.rowCount === 0) {
    return `No active items found under ${categoryType}.`;
  }
  const tableRows = [];
  for (const row of result.rows.slice(0, 20)) {
    const effectivePrice = resolveEffectiveUnitPrice({
      basePrice: Number(row.price_per_unit || 0),
      quantity: 1,
      flashDiscountPercent: Number(row.flash_discount_percent || 0),
      flashDiscountEndsAt: row.flash_discount_ends_at,
      bulkDiscountTiers: row.bulk_discount_tiers,
    });
    tableRows.push([
      String(row.catalog_item_id),
      row.commodity_name || "Item",
      Number(effectivePrice || 0).toLocaleString(),
      Number(row.stock_quantity || 0).toLocaleString(),
      row.company_name || `#${row.masked_id}`,
    ]);
  }
  return [
    `${categoryType.replace(/_/g, " ")} listings`,
    renderTextTable({
      headers: ["ID", "PRODUCT", "PRICE", "STOCK", "SELLER"],
      widths: [4, 18, 9, 7, 14],
      rows: tableRows,
    }),
    "To buy: buy item <ID> <qty>",
  ].join("\n");
};

const compareItemPricesMessage = async ({ searchTerm }) => {
  const result = await query(
    `
      SELECT
        c.id AS catalog_item_id,
        c.commodity_name,
        c.price_per_unit,
        c.flash_discount_percent,
        c.flash_discount_ends_at,
        c.bulk_discount_tiers,
        c.stock_quantity,
        c.unit_measure,
        c.location_label,
        u.masked_id,
        u.company_name
      FROM catalog_items c
      JOIN platform_users u ON u.masked_id = c.seller_masked_id
      WHERE c.is_active = TRUE
        AND c.stock_quantity > 0
        AND u.user_type = 'SUPPLIER'
        AND COALESCE(u.merchant_agreement_status, 'PENDING') = 'ACCEPTED'
        AND LOWER(c.commodity_name) LIKE CONCAT('%', LOWER($1), '%')
      ORDER BY c.price_per_unit ASC
      LIMIT 3
    `,
    [searchTerm]
  );
  if (result.rowCount === 0) {
    return `No comparison offers found for "${searchTerm}".`;
  }
  const tableRows = [];
  result.rows.forEach((row, idx) => {
    const effectivePrice = resolveEffectiveUnitPrice({
      basePrice: Number(row.price_per_unit || 0),
      quantity: 1,
      flashDiscountPercent: Number(row.flash_discount_percent || 0),
      flashDiscountEndsAt: row.flash_discount_ends_at,
      bulkDiscountTiers: row.bulk_discount_tiers,
    });
    tableRows.push([
      String(idx + 1),
      String(row.catalog_item_id),
      row.company_name || `#${row.masked_id}`,
      Number(effectivePrice || 0).toLocaleString(),
      Number(row.stock_quantity || 0).toLocaleString(),
    ]);
  });
  return [
    `Top ${result.rowCount} price comparison for "${searchTerm}"`,
    renderTextTable({
      headers: ["#", "ID", "SELLER", "PRICE", "STOCK"],
      widths: [2, 4, 14, 8, 6],
      rows: tableRows,
    }),
    "To buy: buy item <ID> <qty>",
  ].join("\n");
};

const productDetailCardMessage = async ({ catalogItemId }) => {
  const result = await query(
    `
      SELECT
        c.id,
        c.commodity_name,
        c.price_per_unit,
        c.flash_discount_percent,
        c.flash_discount_ends_at,
        c.bulk_discount_tiers,
        c.stock_quantity,
        c.unit_measure,
        c.location_label,
        c.business_type,
        c.catalog_metadata,
        u.masked_id,
        u.company_name,
        COALESCE(u.merchant_agreement_status, 'PENDING') AS merchant_agreement_status
      FROM catalog_items c
      JOIN platform_users u ON u.masked_id = c.seller_masked_id
      WHERE c.id = $1
      LIMIT 1
    `,
    [catalogItemId]
  );
  if (result.rowCount === 0) return "Product not found.";
  const row = result.rows[0];
  const inferredCategory =
    row.catalog_metadata?.product_category || inferMarketplaceCategory(row.commodity_name);
  const effectivePrice = resolveEffectiveUnitPrice({
    basePrice: Number(row.price_per_unit || 0),
    quantity: 1,
    flashDiscountPercent: Number(row.flash_discount_percent || 0),
    flashDiscountEndsAt: row.flash_discount_ends_at,
    bulkDiscountTiers: row.bulk_discount_tiers,
  });
  const verified = row.merchant_agreement_status === "ACCEPTED" ? "Yes" : "No";
  return [
    `Product Detail #${row.id}`,
    `Name: ${row.commodity_name}`,
    `Seller: ${row.company_name || `#${row.masked_id}`}`,
    `Verified Seller: ${verified}`,
    `Category: ${inferredCategory.replace(/_/g, " ")}`,
    `Price: KSh ${Number(effectivePrice).toLocaleString()} / ${row.unit_measure || "unit"}`,
    `Stock: ${Number(row.stock_quantity || 0).toLocaleString()} (${
      Number(row.stock_quantity || 0) > 0 ? "IN STOCK" : "OUT OF STOCK"
    })`,
    `Location: ${row.location_label || "N/A"}`,
  ].join("\n");
};

const listSupplierCatalogPricesMessage = async ({ sellerMaskedId }) => {
  const result = await query(
    `
      SELECT
        id,
        commodity_name,
        price_per_unit,
        unit_measure,
        stock_quantity,
        catalog_metadata,
        is_active
      FROM catalog_items
      WHERE seller_masked_id = $1
      ORDER BY is_active DESC, commodity_name ASC
      LIMIT 100
    `,
    [sellerMaskedId]
  );

  if (result.rowCount === 0) {
    return "No catalog items found. Add one with: Add new item: Product Name, Price 150, Stock 20";
  }

  const tableRows = result.rows.map((row) => [
    String(row.id),
    row.commodity_name || "Item",
    row.unit_measure || "unit",
    Number(row.price_per_unit || 0).toLocaleString(),
    Number(row.stock_quantity || 0).toLocaleString(),
    String(
      row.catalog_metadata?.product_category || inferMarketplaceCategory(row.commodity_name)
    )
      .replace(/_/g, " ")
      .slice(0, 8),
    row.is_active ? "ACTIVE" : "INACTIVE",
  ]);
  return [
    "Your catalog table",
    renderTextTable({
      headers: ["ID", "PRODUCT", "UNIT", "PRICE", "STOCK", "CAT", "STATUS"],
      widths: [4, 16, 8, 8, 6, 8, 8],
      rows: tableRows,
    }),
    "Edit commands:",
    "- /update price <ID> <NEW_PRICE>",
    "- add stock <QTY> <ITEM NAME>",
    "- delete item <ID>",
  ].join("\n");
};

const getCartItemsForBuyer = async ({ buyerMaskedId }) => {
  const result = await query(
    `
      SELECT
        ci.id,
        ci.catalog_item_id,
        ci.seller_masked_id,
        ci.quantity,
        c.commodity_name,
        c.price_per_unit,
        c.flash_discount_percent,
        c.flash_discount_ends_at,
        c.bulk_discount_tiers,
        c.stock_quantity,
        c.unit_measure,
        u.company_name
      FROM cart_items ci
      JOIN catalog_items c ON c.id = ci.catalog_item_id
      JOIN platform_users u ON u.masked_id = ci.seller_masked_id
      WHERE ci.buyer_masked_id = $1
      ORDER BY ci.updated_at DESC
    `,
    [buyerMaskedId]
  );
  return result.rows;
};

const cartSummaryMessage = ({ items }) => {
  if (!items || items.length === 0) {
    return "Cart is empty. Add items with: cart add <item_id> <qty>";
  }
  let total = 0;
  const lines = ["Your shopping cart:"];
  items.forEach((item, idx) => {
    const effectiveUnitPrice = resolveEffectiveUnitPrice({
      basePrice: Number(item.price_per_unit || 0),
      quantity: Number(item.quantity || 0),
      flashDiscountPercent: Number(item.flash_discount_percent || 0),
      flashDiscountEndsAt: item.flash_discount_ends_at,
      bulkDiscountTiers: item.bulk_discount_tiers,
    });
    const lineTotal = Number(item.quantity) * Number(effectiveUnitPrice || 0);
    total += lineTotal;
    lines.push(
      "",
      `${idx + 1}. ${item.commodity_name} (ID ${item.catalog_item_id})`,
      `Seller: ${item.company_name || `#${item.seller_masked_id}`}`,
      `Qty: ${Number(item.quantity)} x KSh ${Number(effectiveUnitPrice).toLocaleString()} = KSh ${lineTotal.toLocaleString()}`
    );
  });
  lines.push("", `Estimated total: KSh ${total.toLocaleString()}`);
  lines.push("Next: checkout");
  return lines.join("\n");
};

const addToCart = async ({ buyerMaskedId, catalogItemId, quantity }) => {
  const itemResult = await query(
    `
      SELECT id, seller_masked_id, stock_quantity
      FROM catalog_items
      WHERE id = $1
        AND is_active = TRUE
      LIMIT 1
    `,
    [catalogItemId]
  );
  if (itemResult.rowCount === 0) {
    throw new Error("Catalog item not found.");
  }
  const item = itemResult.rows[0];
  if (Number(item.stock_quantity || 0) <= 0) {
    throw new Error("Item is out of stock.");
  }

  const existing = await getCartItemsForBuyer({ buyerMaskedId });
  if (existing.length > 0) {
    const sellerSet = new Set(existing.map((row) => row.seller_masked_id));
    if (!sellerSet.has(item.seller_masked_id)) {
      throw new Error(
        "Cart currently supports one seller per checkout. Clear cart first or add from the same seller."
      );
    }
  }

  await query(
    `
      INSERT INTO cart_items (
        buyer_masked_id,
        catalog_item_id,
        seller_masked_id,
        quantity,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (buyer_masked_id, catalog_item_id)
      DO UPDATE SET
        quantity = EXCLUDED.quantity,
        updated_at = NOW()
    `,
    [buyerMaskedId, catalogItemId, item.seller_masked_id, quantity]
  );
};

const clearCart = async ({ buyerMaskedId }) => {
  await query(`DELETE FROM cart_items WHERE buyer_masked_id = $1`, [buyerMaskedId]);
};

const addWishlistItem = async ({ buyerMaskedId, catalogItemId }) => {
  await query(
    `
      INSERT INTO wishlist_items (buyer_masked_id, catalog_item_id)
      VALUES ($1, $2)
      ON CONFLICT (buyer_masked_id, catalog_item_id) DO NOTHING
    `,
    [buyerMaskedId, catalogItemId]
  );
};

const removeWishlistItem = async ({ buyerMaskedId, catalogItemId }) => {
  await query(
    `
      DELETE FROM wishlist_items
      WHERE buyer_masked_id = $1
        AND catalog_item_id = $2
    `,
    [buyerMaskedId, catalogItemId]
  );
};

const wishlistSummaryMessage = async ({ buyerMaskedId }) => {
  const result = await query(
    `
      SELECT
        w.catalog_item_id,
        c.commodity_name,
        c.price_per_unit,
        c.stock_quantity,
        c.unit_measure,
        u.company_name
      FROM wishlist_items w
      JOIN catalog_items c ON c.id = w.catalog_item_id
      JOIN platform_users u ON u.masked_id = c.seller_masked_id
      WHERE w.buyer_masked_id = $1
      ORDER BY w.created_at DESC
      LIMIT 30
    `,
    [buyerMaskedId]
  );
  if (result.rowCount === 0) return "Wishlist is empty.";
  const lines = ["Your wishlist items:"];
  result.rows.forEach((row, idx) => {
    lines.push(
      "",
      `${idx + 1}. ${row.commodity_name} (ID ${row.catalog_item_id})`,
      `Seller: ${row.company_name}`,
      `Price: KSh ${Number(row.price_per_unit || 0).toLocaleString()} / ${row.unit_measure || "unit"} | Stock: ${
        Number(row.stock_quantity || 0) > 0 ? "IN" : "OUT"
      }`
    );
  });
  return lines.join("\n");
};

const ensureReferralCode = async ({ userMaskedId }) => {
  const existing = await query(
    `SELECT referral_code FROM referral_codes WHERE owner_masked_id = $1 LIMIT 1`,
    [userMaskedId]
  );
  if (existing.rowCount > 0) return existing.rows[0].referral_code;
  const code = `AGZ${userMaskedId}${Math.floor(100 + Math.random() * 900)}`;
  await query(
    `
      INSERT INTO referral_codes (owner_masked_id, referral_code, created_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (owner_masked_id) DO NOTHING
    `,
    [userMaskedId, code]
  );
  return code;
};

const getLoyaltyBalance = async ({ buyerMaskedId }) => {
  const result = await query(
    `
      SELECT points_balance
      FROM loyalty_wallets
      WHERE buyer_masked_id = $1
      LIMIT 1
    `,
    [buyerMaskedId]
  );
  return Number(result.rows?.[0]?.points_balance || 0);
};

const subscribeBackInStockAlert = async ({ buyerMaskedId, catalogItemId }) => {
  await query(
    `
      INSERT INTO restock_alert_subscriptions (buyer_masked_id, catalog_item_id, created_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (buyer_masked_id, catalog_item_id) DO NOTHING
    `,
    [buyerMaskedId, catalogItemId]
  );
};

const notifyBackInStockAlerts = async ({ catalogItemId }) => {
  const watchers = await query(
    `
      SELECT
        s.id,
        s.buyer_masked_id,
        p.phone_number,
        c.commodity_name,
        c.stock_quantity
      FROM restock_alert_subscriptions s
      JOIN platform_users p ON p.masked_id = s.buyer_masked_id
      JOIN catalog_items c ON c.id = s.catalog_item_id
      WHERE s.catalog_item_id = $1
        AND c.stock_quantity > 0
    `,
    [catalogItemId]
  );
  let notified = 0;
  for (const row of watchers.rows) {
    const ok = await safeNotifyWhatsappPhone({
      toPhone: row.phone_number,
      message: `Back in stock: ${row.commodity_name} now has ${Number(
        row.stock_quantity || 0
      ).toLocaleString()} units. Reply buy to view offers.`,
    });
    if (ok) {
      notified += 1;
      await query(`DELETE FROM restock_alert_subscriptions WHERE id = $1`, [row.id]);
    }
  }
  return { notified };
};

const searchCatalogRows = async ({ searchTerm, excludeSellerMaskedId = null }) => {
  return query(
    `
      SELECT
        c.id AS catalog_item_id,
        c.seller_masked_id,
        c.commodity_name,
        c.price_per_unit,
        c.flash_discount_percent,
        c.flash_discount_ends_at,
        c.bulk_discount_tiers,
        c.promoted_until,
        c.unit_measure,
        c.location_label,
        c.business_type,
        c.stock_quantity,
        u.company_name,
        u.seller_tier,
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
      ORDER BY
        CASE WHEN c.promoted_until IS NOT NULL AND c.promoted_until > NOW() THEN 0 ELSE 1 END ASC,
        CASE WHEN COALESCE(u.seller_tier, 'FREE') = 'PREMIUM' THEN 0 ELSE 1 END ASC,
        c.price_per_unit ASC,
        c.created_at ASC
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
      const effectivePrice = resolveEffectiveUnitPrice({
        basePrice: Number(row.price_per_unit || 0),
        quantity: 1,
        flashDiscountPercent: Number(row.flash_discount_percent || 0),
        flashDiscountEndsAt: row.flash_discount_ends_at,
        bulkDiscountTiers: row.bulk_discount_tiers,
      });
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
        effectivePrice,
      };
    })
    .sort((a, b) => {
      const da = a.distanceKm == null ? Number.MAX_SAFE_INTEGER : Number(a.distanceKm);
      const db = b.distanceKm == null ? Number.MAX_SAFE_INTEGER : Number(b.distanceKm);
      if (da !== db) return da - db;
      return Number(a.effectivePrice) - Number(b.effectivePrice);
    });
};

const buildSearchInteractiveList = ({ searchTerm, rankedRows }) => {
  const rows = rankedRows.slice(0, 10).map((row) => ({
    id: `search_select_${row.catalog_item_id}_${row.seller_masked_id}`,
    title: `${row.company_name || `Seller #${row.seller_masked_id}`} - KSh ${Number(
      row.effectivePrice || row.price_per_unit
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
  const tableRows = rankedRows.slice(0, 10).map((row, idx) => [
    String(idx + 1),
    String(row.catalog_item_id),
    row.commodity_name || "Item",
    Number(row.effectivePrice || row.price_per_unit || 0).toLocaleString(),
    row.unit_measure || "unit",
    Number(row.stock_quantity || 0).toLocaleString(),
  ]);
  lines.push(
    renderTextTable({
      headers: ["#", "ID", "PRODUCT", "PRICE", "UNIT", "STOCK"],
      widths: [2, 4, 16, 8, 7, 6],
      rows: tableRows,
    })
  );
  rankedRows.slice(0, 10).forEach((row, idx) => {
    lines.push(
      `${idx + 1}. Seller: ${row.company_name || `Seller #${row.seller_masked_id}`} | Location: ${
        row.location_label || "Location"
      }`,
      `   Select with: ${idx + 1} OR search_select_${row.catalog_item_id}_${row.seller_masked_id}`
    );
  });
  lines.push("", "Reply with row number (1..10), or full selection ID, or 2 to cancel.");
  return lines.join("\n");
};

const parseSearchSelectionId = (rawMessage) => {
  const trimmed = String(rawMessage || "").trim();
  const match = trimmed
    .trim()
    .match(/^search_select_(\d+)_([0-9]{5})$/i);
  if (match) {
    return {
      catalogItemId: Number(match[1]),
      sellerMaskedId: match[2],
      rowNumber: null,
    };
  }
  const rowNumberMatch = trimmed.match(/^(?:row\s*)?([1-9]|10)$/i);
  if (rowNumberMatch) {
    return {
      catalogItemId: null,
      sellerMaskedId: null,
      rowNumber: Number(rowNumberMatch[1]),
    };
  }
  return null;
};

const buildSearchQuantityPrompt = ({ row }) =>
  [
    `Selected: ${row.commodity_name} from ${row.company_name || `Seller #${row.seller_masked_id}`}`,
    `Price: KSh ${Number(row.effectivePrice || row.price_per_unit).toLocaleString()} per ${
      row.unit_measure || "unit"
    }`,
    `Location: ${row.location_label || "N/A"}`,
    `In stock: ${Number(row.stock_quantity || 0).toLocaleString()}`,
    "",
    "Reply with quantity number to continue (or 0 to cancel).",
  ].join("\n");

const isAdminPhone = (communicationPhone, senderPhone) => {
  const configuredPhones = Array.isArray(env.admin.whatsappPhones)
    ? env.admin.whatsappPhones
    : [];
  if (configuredPhones.length === 0) return false;

  const normalizedSender = normalizeMsisdn(senderPhone || "");
  const normalizedCommunication = String(communicationPhone || "").trim();

  return configuredPhones.some((configured) => {
    const raw = String(configured || "").trim();
    if (!raw) return false;
    if (raw === normalizedCommunication) return true;
    const digits = normalizeMsisdn(raw.replace("whatsapp:+", ""));
    return digits && digits === normalizedSender;
  });
};

const handleAdminCommand = async (rawMessage, senderPhone) => {
  const trimmed = String(rawMessage || "").trim();
  const lower = trimmed.toLowerCase();
  const pendingAction = getAdminPendingAction({ senderPhone });

  if (pendingAction) {
    if (isExplicitAdminCommand(trimmed)) {
      clearAdminPendingAction({ senderPhone });
      return handleAdminCommand(trimmed, senderPhone);
    }

    if (["cancel", "back", "menu", "admin menu", "0"].includes(lower)) {
      clearAdminPendingAction({ senderPhone });
      return "Pending admin action cancelled.";
    }

    if (pendingAction.actionType === "RELEASE_ORDER") {
      if (!looksLikeOrderId(trimmed)) {
        return "Please send a valid ORDER-ID to release (example: 7a2f1c80-... or AGZ12345).";
      }
      clearAdminPendingAction({ senderPhone });
      return handleAdminCommand(`release ${trimmed}`, senderPhone);
    }
    if (pendingAction.actionType === "FORCE_REFUND_ORDER") {
      if (!looksLikeOrderId(trimmed)) {
        return "Please send a valid ORDER-ID to refund (example: 7a2f1c80-... or AGZ12345).";
      }
      clearAdminPendingAction({ senderPhone });
      return handleAdminCommand(`force refund ${trimmed}`, senderPhone);
    }
    if (pendingAction.actionType === "CLOSE_ORDER") {
      if (!looksLikeOrderId(trimmed)) {
        return "Please send a valid ORDER-ID to close (example: 7a2f1c80-... or AGZ12345).";
      }
      clearAdminPendingAction({ senderPhone });
      return handleAdminCommand(`close order ${trimmed}`, senderPhone);
    }
    if (pendingAction.actionType === "BROADCAST_BUYERS") {
      if (trimmed.length < 2) {
        return "Broadcast message is too short. Send the full message text (or type cancel).";
      }
      clearAdminPendingAction({ senderPhone });
      return handleAdminCommand(`broadcast buyers ${trimmed}`, senderPhone);
    }
    if (pendingAction.actionType === "BROADCAST_ALL") {
      if (trimmed.length < 2) {
        return "Broadcast message is too short. Send the full message text (or type cancel).";
      }
      clearAdminPendingAction({ senderPhone });
      return handleAdminCommand(`broadcast all ${trimmed}`, senderPhone);
    }
  }

  if (lower === "0" || lower === "menu" || lower === "admin menu") {
    return adminCommandMenu();
  }

  if (lower === "version" || lower === "admin version" || lower === "build") {
    const commit = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "unknown";
    const branch = process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || "unknown";
    const adminPhones = Array.isArray(env.admin.whatsappPhones) ? env.admin.whatsappPhones.length : 0;
    return [
      "Admin runtime info",
      `Branch: ${branch}`,
      `Commit: ${commit}`,
      `Admin phones configured: ${adminPhones}`,
      `Alert channel: ${env.admin.alertChannel || "WHATSAPP"}`,
    ].join("\n");
  }

  if (trimmed === "2" || lower === "orders") {
    const pending = await query(
      `
        SELECT
          id,
          buyer_masked_id,
          supplier_masked_id,
          total_amount_kes,
          payment_status,
          settlement_status
        FROM orders
        WHERE payment_status IN ('PENDING_PAYMENT', 'PAID_HELD', 'REFUND_REQUESTED')
           OR settlement_status IN ('IN_PROGRESS', 'AWAITING_RELEASE', 'ON_HOLD')
        ORDER BY created_at DESC
        LIMIT 10
      `
    );
    if (pending.rowCount === 0) return "No pending orders right now.";
    const lines = pending.rows.map(
      (row, index) =>
        `${index + 1}. #${String(row.id).slice(0, 8)} | KSh ${Number(
          row.total_amount_kes || 0
        ).toLocaleString()} | ${row.payment_status}/${row.settlement_status} | buyer #${
          row.buyer_masked_id || "--"
        }`
    );
    return ["Pending orders (latest 10):", ...lines].join("\n");
  }

  if (trimmed === "3" || lower === "users") {
    const users = await query(
      `
        SELECT
          masked_id,
          user_type,
          company_name,
          phone_number,
          current_step
        FROM platform_users
        ORDER BY created_at DESC
        LIMIT 15
      `
    );
    if (users.rowCount === 0) return "No users found.";
    const lines = users.rows.map((row, index) => {
      const phone = row.phone_number ? maskBuyerPhone(row.phone_number) : "--";
      const profile = row.company_name || "Unnamed";
      return `${index + 1}. #${row.masked_id} | ${row.user_type || "UNSET"} | ${profile} | ${phone} | ${
        formatUserStepLabel(row.current_step || "START")
      }`;
    });
    return ["Recent users (latest 15):", ...lines].join("\n");
  }

  if (trimmed === "4") {
    setAdminPendingAction({ senderPhone, actionType: "RELEASE_ORDER" });
    return "Release selected. Send ORDER-ID to release funds (or type cancel).";
  }
  if (trimmed === "5") {
    setAdminPendingAction({ senderPhone, actionType: "FORCE_REFUND_ORDER" });
    return "Force refund selected. Send ORDER-ID to refund (or type cancel).";
  }
  if (trimmed === "6") {
    setAdminPendingAction({ senderPhone, actionType: "CLOSE_ORDER" });
    return "Close order selected. Send ORDER-ID to force-close (or type cancel).";
  }
  if (trimmed === "8") {
    setAdminPendingAction({ senderPhone, actionType: "BROADCAST_BUYERS" });
    return "Broadcast buyers selected. Send the message text to send (or type cancel).";
  }
  if (trimmed === "9") {
    setAdminPendingAction({ senderPhone, actionType: "BROADCAST_ALL" });
    return "Broadcast all selected. Send the message text to send (or type cancel).";
  }

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

  const unmuteMatch = rawMessage.match(adminUnmutePattern);
  if (unmuteMatch) {
    const targetPhone = normalizeMsisdn(unmuteMatch[1]);
    await clearSenderBlocks({ phoneNumber: targetPhone });
    return `Security block cleared for ${targetPhone}.`;
  }

  const broadcastBuyersMatch = rawMessage.match(adminBroadcastBuyersPattern);
  if (broadcastBuyersMatch) {
    const promoText = String(broadcastBuyersMatch[1] || "").trim();
    if (!promoText) return "Use: broadcast buyers <message>";
    const buyers = await query(
      `
        SELECT DISTINCT phone_number
        FROM platform_users
        WHERE user_type = 'BUYER'
          AND current_step = 'COMPLETED'
          AND phone_number IS NOT NULL
      `
    );
    let sentCount = 0;
    for (const row of buyers.rows) {
      const ok = await safeNotifyWhatsappPhone({
        toPhone: row.phone_number,
        message: `📣 AgizaHub Promo\n${promoText}`,
      });
      if (ok) sentCount += 1;
    }
    await query(
      `
        INSERT INTO promo_broadcasts (
          created_by_phone,
          target_role,
          message_text,
          status,
          sent_count,
          created_at,
          sent_at
        )
        VALUES ($1, 'BUYER', $2, 'SENT', $3, NOW(), NOW())
      `,
      [senderPhone, promoText, sentCount]
    );
    return `Promo broadcast sent to ${sentCount} buyers.`;
  }

  const broadcastSellersMatch = rawMessage.match(adminBroadcastSellersPattern);
  if (broadcastSellersMatch) {
    const promoText = String(broadcastSellersMatch[1] || "").trim();
    if (!promoText) return "Use: broadcast sellers <message>";
    const sellers = await query(
      `
        SELECT DISTINCT phone_number
        FROM platform_users
        WHERE user_type = 'SUPPLIER'
          AND current_step = 'COMPLETED'
          AND phone_number IS NOT NULL
      `
    );
    let sentCount = 0;
    for (const row of sellers.rows) {
      const ok = await safeNotifyWhatsappPhone({
        toPhone: row.phone_number,
        message: `📣 AgizaHub Seller Notice\n${promoText}`,
      });
      if (ok) sentCount += 1;
    }
    await query(
      `
        INSERT INTO promo_broadcasts (
          created_by_phone,
          target_role,
          message_text,
          status,
          sent_count,
          created_at,
          sent_at
        )
        VALUES ($1, 'SUPPLIER', $2, 'SENT', $3, NOW(), NOW())
      `,
      [senderPhone, promoText, sentCount]
    );
    return `Broadcast sent to ${sentCount} sellers.`;
  }

  const broadcastAllMatch = rawMessage.match(adminBroadcastAllPattern);
  if (broadcastAllMatch) {
    const promoText = String(broadcastAllMatch[1] || "").trim();
    if (!promoText) return "Use: broadcast all <message>";
    const users = await query(
      `
        SELECT DISTINCT phone_number
        FROM platform_users
        WHERE current_step = 'COMPLETED'
          AND phone_number IS NOT NULL
      `
    );
    let sentCount = 0;
    for (const row of users.rows) {
      const ok = await safeNotifyWhatsappPhone({
        toPhone: row.phone_number,
        message: `📣 AgizaHub Notice\n${promoText}`,
      });
      if (ok) sentCount += 1;
    }
    await query(
      `
        INSERT INTO promo_broadcasts (
          created_by_phone,
          target_role,
          message_text,
          status,
          sent_count,
          created_at,
          sent_at
        )
        VALUES ($1, 'ALL', $2, 'SENT', $3, NOW(), NOW())
      `,
      [senderPhone, promoText, sentCount]
    );
    return `Broadcast sent to ${sentCount} users.`;
  }

  const payoutApproveMatch = rawMessage.match(adminPayoutApprovePattern);
  if (payoutApproveMatch) {
    const requestId = Number(payoutApproveMatch[1]);
    const requestResult = await query(
      `
        SELECT
          r.id,
          r.amount_kes,
          r.status,
          u.payout_phone,
          u.company_name,
          u.masked_id
        FROM seller_payout_requests r
        JOIN platform_users u ON u.masked_id = r.seller_masked_id
        WHERE r.id = $1
        LIMIT 1
      `,
      [requestId]
    );
    if (requestResult.rowCount === 0) {
      return `Payout request #${requestId} not found.`;
    }
    const request = requestResult.rows[0];
    if (request.status !== "PENDING") {
      return `Payout request #${requestId} is already ${request.status}.`;
    }
    if (!request.payout_phone) {
      await query(
        `
          UPDATE seller_payout_requests
          SET status = 'FAILED',
              failure_reason = 'Missing seller payout phone',
              approved_by_phone = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [requestId, senderPhone]
      );
      return `Payout request #${requestId} failed: seller payout phone missing.`;
    }
    try {
      const b2c = await sendB2CPayment({
        phoneNumber: request.payout_phone,
        amount: Number(request.amount_kes),
        remarks: `Seller payout #${requestId}`,
        occasion: "Seller withdrawal",
      });
      const reference =
        b2c.OriginatorConversationID || b2c.ConversationID || b2c.ResponseDescription || null;
      await query(
        `
          UPDATE seller_payout_requests
          SET status = 'PAID',
              approved_by_phone = $2,
              disbursement_reference = $3,
              updated_at = NOW()
          WHERE id = $1
        `,
        [requestId, senderPhone, reference]
      );
      return `Payout #${requestId} paid to ${request.company_name || request.masked_id} (KSh ${Number(
        request.amount_kes
      ).toLocaleString()}).`;
    } catch (error) {
      await query(
        `
          UPDATE seller_payout_requests
          SET status = 'FAILED',
              approved_by_phone = $2,
              failure_reason = $3,
              updated_at = NOW()
          WHERE id = $1
        `,
        [requestId, senderPhone, error.message]
      );
      return `Payout #${requestId} failed: ${error.message}`;
    }
  }

  if (trimmed === "1" || trimmed === "7" || adminRevenuePattern.test(trimmed)) {
    const revenue = await query(
      `
        SELECT
          COUNT(*) AS orders_count,
          COALESCE(SUM(total_amount_kes), 0) AS gross_volume_kes,
          COALESCE(SUM(platform_fee_kes), 0) AS platform_fee_kes,
          COALESCE(SUM(incoming_gateway_fee_kes), 0) AS incoming_gateway_fees_kes
        FROM orders
        WHERE created_at >= date_trunc('day', NOW())
      `
    );
    const row = revenue.rows[0] || {};
    return [
      "Revenue dashboard (today)",
      `Orders: ${Number(row.orders_count || 0).toLocaleString()}`,
      `Gross volume: KSh ${Number(row.gross_volume_kes || 0).toLocaleString()}`,
      `Platform commission: KSh ${Number(row.platform_fee_kes || 0).toLocaleString()}`,
      `Incoming gateway fees: KSh ${Number(row.incoming_gateway_fees_kes || 0).toLocaleString()}`,
    ].join("\n");
  }

  const overrideMatch = rawMessage.match(adminOverrideOrderPattern);
  if (overrideMatch) {
    const orderId = normalizeOrderIdFromText(overrideMatch[1]);
    const field = String(overrideMatch[2] || "").toLowerCase();
    const value = String(overrideMatch[3] || "").toUpperCase();
    const allowed = new Set([
      "payment_status",
      "settlement_status",
      "distribution_status",
      "order_progress_status",
    ]);
    if (!allowed.has(field)) {
      return `Override field not allowed: ${field}`;
    }
    await query(
      `
        UPDATE orders
        SET ${field} = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [orderId, value]
    );
    await query(
      `
        INSERT INTO admin_action_events (
          order_id,
          actor_phone,
          action_type,
          action_payload
        )
        VALUES ($1, $2, 'ADMIN_OVERRIDE', $3)
      `,
      [orderId, senderPhone, JSON.stringify({ field, value })]
    );
    return `Override applied for order #${orderId}: ${field}=${value}`;
  }

  const forceRefundMatch = rawMessage.match(adminForceRefundPattern);
  if (forceRefundMatch) {
    const orderId = normalizeOrderIdFromText(forceRefundMatch[1]);
    const orderResult = await query(
      `
        SELECT id, payment_status, buyer_masked_id, buyer_phone
        FROM orders
        WHERE id = $1
        LIMIT 1
      `,
      [orderId]
    );
    if (orderResult.rowCount === 0) return `Order #${orderId} not found.`;
    const order = orderResult.rows[0];
    if (order.payment_status === "PAID_HELD") {
      await requestOrderRefund({
        orderId,
        buyerMaskedId: order.buyer_masked_id,
        buyerPhone: order.buyer_phone,
        reason: "Admin force refund",
      });
      await approveRefundByAdmin({ orderId, actorPhone: senderPhone });
      return `Force-refund completed for order #${orderId}.`;
    }
    if (order.payment_status === "REFUND_REQUESTED") {
      await approveRefundByAdmin({ orderId, actorPhone: senderPhone });
      return `Pending refund approved for order #${orderId}.`;
    }
    return `Order #${orderId} is not refundable in status ${order.payment_status}.`;
  }

  const closeOrderMatch = rawMessage.match(adminCloseOrderPattern);
  if (closeOrderMatch) {
    const orderId = normalizeOrderIdFromText(closeOrderMatch[1]);
    await query(
      `
        UPDATE orders
        SET settlement_status = 'COMPLETED',
            distribution_status = 'COMPLETED',
            order_progress_status = 'DELIVERED',
            updated_at = NOW()
        WHERE id = $1
      `,
      [orderId]
    );
    await query(
      `
        INSERT INTO admin_action_events (
          order_id,
          actor_phone,
          action_type,
          action_payload
        )
        VALUES ($1, $2, 'ADMIN_FORCE_CLOSE', $3)
      `,
      [orderId, senderPhone, JSON.stringify({ orderId })]
    );
    return `Order #${orderId} force-closed by admin.`;
  }

  const tierMatch = rawMessage.match(adminSetTierPattern);
  if (tierMatch) {
    const sellerMaskedId = tierMatch[1];
    const tier = String(tierMatch[2] || "").toUpperCase();
    await query(
      `
        UPDATE platform_users
        SET seller_tier = $2,
            updated_at = NOW()
        WHERE masked_id = $1
          AND user_type = 'SUPPLIER'
      `,
      [sellerMaskedId, tier]
    );
    return `Seller #${sellerMaskedId} tier set to ${tier}.`;
  }

  return null;
};

const mapDisputeIssueToHelpOption = (issueType) => {
  if (issueType === "WRONG_ORDER") return "1";
  if (issueType === "NO_DELIVERY_CODE") return "2";
  if (issueType === "TRANSPORTER_DELAY") return "3";
  if (issueType === "PAYMENT_REFUND") return "4";
  if (issueType === "HUMAN_ADMIN") return "5";
  return null;
};

const resolveSupportOrderForUser = async ({ user, senderPhone, explicitOrderId }) => {
  const orderId = explicitOrderId ? normalizeOrderIdFromText(explicitOrderId) : null;
  const buyerQuery = `
    SELECT *
    FROM orders
    WHERE (buyer_masked_id = $1 OR buyer_phone = $2)
      AND ($3::text IS NULL OR id::text = $3)
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const supplierQuery = `
    SELECT *
    FROM orders
    WHERE supplier_masked_id = $1
      AND ($2::text IS NULL OR id::text = $2)
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const transporterQuery = `
    SELECT *
    FROM orders
    WHERE transporter_masked_id = $1
      AND ($2::text IS NULL OR id::text = $2)
    ORDER BY created_at DESC
    LIMIT 1
  `;

  let result;
  if (user.user_type === "BUYER" || !user.user_type) {
    result = await query(buyerQuery, [user.masked_id || null, senderPhone, orderId]);
  } else if (user.user_type === "SUPPLIER") {
    result = await query(supplierQuery, [user.masked_id, orderId]);
  } else {
    result = await query(transporterQuery, [user.masked_id, orderId]);
  }
  return result.rows[0] || null;
};

const escalateSupportCase = async ({
  user,
  issueType,
  senderPhone,
  order,
  note,
  freezeThread = false,
}) => {
  await query(
    `
      UPDATE platform_users
      SET requires_admin_intervention = TRUE,
          bot_thread_frozen = $2,
          current_step = CASE WHEN $2 THEN 'AWAITING_ADMIN_INTERVENTION' ELSE 'COMPLETED' END,
          support_ticket_context = $3,
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      user.id,
      Boolean(freezeThread),
      JSON.stringify({
        issueType,
        note: note || null,
        orderId: order?.id || null,
        createdAt: new Date().toISOString(),
      }),
    ]
  );

  if (order?.id) {
    await query(
      `
        UPDATE orders
        SET requires_admin_intervention = TRUE,
            updated_at = NOW()
        WHERE id = $1
      `,
      [order.id]
    );
  }

  await sendDisputeEscalationAlert({
    orderId: order?.id || null,
    issueType,
    reporterPhone: senderPhone,
    note,
    payload: {
      issueType,
      senderPhone,
      userMaskedId: user.masked_id,
      userType: user.user_type,
      orderId: order?.id || null,
    },
  });
};

const freezeOrderAsDisputed = async ({ orderId, reason }) => {
  await query(
    `
      UPDATE orders
      SET settlement_status =
            CASE
              WHEN payment_status IN ('PAID_HELD', 'REFUND_REQUESTED') THEN 'DISPUTED_HOLD'
              ELSE settlement_status
            END,
          distribution_status =
            CASE
              WHEN payment_status IN ('PAID_HELD', 'REFUND_REQUESTED') THEN 'DISPUTED_HOLD'
              ELSE distribution_status
            END,
          dispute_reason = COALESCE($2, dispute_reason, 'Support dispute raised'),
          requires_admin_intervention = TRUE,
          updated_at = NOW()
      WHERE id = $1
    `,
    [orderId, reason || null]
  );
};

const resolveNavigationLinkForOrder = async ({ orderId }) => {
  const orderResult = await query(
    `
      SELECT
        o.id,
        o.order_type,
        o.parsed_payload,
        s.hub_latitude AS supplier_latitude,
        s.hub_longitude AS supplier_longitude,
        b.delivery_latitude AS buyer_latitude,
        b.delivery_longitude AS buyer_longitude
      FROM orders o
      LEFT JOIN platform_users s ON s.masked_id = o.supplier_masked_id
      LEFT JOIN platform_users b ON b.masked_id = o.buyer_masked_id
      WHERE o.id = $1
      LIMIT 1
    `,
    [orderId]
  );
  if (orderResult.rowCount === 0) return null;
  const row = orderResult.rows[0];

  let originLat = row.supplier_latitude;
  let originLng = row.supplier_longitude;
  let destinationLat = row.buyer_latitude;
  let destinationLng = row.buyer_longitude;

  if (row.order_type === "TRANSPORT_ONLY") {
    const payload = row.parsed_payload || {};
    originLat = payload.pickupLat ?? payload.pickup_lat ?? originLat;
    originLng = payload.pickupLng ?? payload.pickup_lng ?? originLng;
    destinationLat = payload.dropoffLat ?? payload.dropoff_lat ?? destinationLat;
    destinationLng = payload.dropoffLng ?? payload.dropoff_lng ?? destinationLng;
  }

  return buildGoogleMapsDirectionsLink({
    originLat,
    originLng,
    destinationLat,
    destinationLng,
  });
};

const processHelpSelection = async ({ user, senderPhone, rawMessage, explicitOrderId = null }) => {
  let option = parseHelpOption(rawMessage);
  let aiTriage = null;
  if (!option) {
    aiTriage = await parseDisputeIntentMessage(rawMessage);
    option = mapDisputeIssueToHelpOption(aiTriage.issue_type);
  }

  if (!option) {
    return {
      message: `Please select one help option from the list.\n\n${helpCenterMenu()}`,
      interactiveList: helpCenterInteractiveList(),
    };
  }

  const latestOrder = await resolveSupportOrderForUser({
    user,
    senderPhone,
    explicitOrderId,
  });

  if (option === "1") {
    if (!latestOrder) {
      await query(
        `
          UPDATE platform_users
          SET current_step = 'COMPLETED',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return {
        message:
          "No recent order found. Send your Order ID (example: support <order-id>) and we'll open an investigation.",
      };
    }

    await freezeOrderAsDisputed({
      orderId: latestOrder.id,
      reason: "Wrong order dispute raised by customer",
    });
    await escalateSupportCase({
      user,
      issueType: "WRONG_ORDER",
      senderPhone,
      order: latestOrder,
      note: "Customer reports wrong order delivered.",
    });

    return {
      message: [
        `Order #${latestOrder.id.slice(0, 8)} moved to DISPUTED_HOLD.`,
        "Please upload a clear photo of delivered goods for admin inspection.",
      ].join("\n"),
      freezeThread: false,
    };
  }

  if (option === "2") {
    if (!latestOrder) {
      await query(
        `
          UPDATE platform_users
          SET current_step = 'COMPLETED',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return { message: "No recent order found for delivery-code recovery." };
    }
    if (latestOrder.payment_status === "PENDING_PAYMENT") {
      return {
        message:
          "We have not received your payment confirmation yet. Check your phone for an STK prompt and complete payment first.",
      };
    }
    if (!["PAID_HELD", "REFUND_REQUESTED"].includes(latestOrder.payment_status)) {
      return {
        message: `Order #${latestOrder.id.slice(0, 8)} is not in active escrow state for code recovery.`,
      };
    }
    if (latestOrder.settlement_status === "COMPLETED") {
      return {
        message: `Order #${latestOrder.id.slice(0, 8)} is already completed and released.`,
      };
    }

    const { otp, otpHash } = await generateEscrowToken();
    await query(
      `
        UPDATE orders
        SET otp_code_hash = $2,
            otp_expires_at = NOW() + INTERVAL '12 hours',
            updated_at = NOW()
        WHERE id = $1
      `,
      [latestOrder.id, otpHash]
    );

    return {
      message: [
        `Delivery code regenerated for order #${latestOrder.id.slice(0, 8)}: ${otp}`,
        "Do NOT share this code until goods are received and verified.",
      ].join("\n"),
      freezeThread: false,
    };
  }

  if (option === "3") {
    if (!latestOrder) {
      return { message: "No active order found for transporter delay support." };
    }
    await freezeOrderAsDisputed({
      orderId: latestOrder.id,
      reason: "Transporter delay escalated by customer",
    });
    await escalateSupportCase({
      user,
      issueType: "TRANSPORTER_DELAY",
      senderPhone,
      order: latestOrder,
      note: "Driver delay/unresponsive complaint.",
    });
    return {
      message: `Delay ticket opened for order #${latestOrder.id.slice(0, 8)}. Admin is reviewing and may rematch transporter.`,
      freezeThread: false,
    };
  }

  if (option === "4") {
    if (!latestOrder) {
      return { message: "No paid order found for refund processing." };
    }
    if (user.user_type !== "BUYER") {
      await escalateSupportCase({
        user,
        issueType: "PAYMENT_REFUND",
        senderPhone,
        order: latestOrder,
        note: "Non-buyer refund inquiry escalated for admin handling.",
      });
      return {
        message:
          "Refund and payment reversals are approved for buyers only. Admin has been notified to assist.",
      };
    }
    const transporterArrived =
      latestOrder.release_requested_at != null ||
      ["AWAITING_RELEASE", "COMPLETED"].includes(latestOrder.settlement_status);
    if (transporterArrived) {
      await escalateSupportCase({
        user,
        issueType: "PAYMENT_REFUND",
        senderPhone,
        order: latestOrder,
        note: "Refund requested after transporter arrival; requires manual inspection.",
      });
      return {
        message:
          "Your refund request was escalated to admin for manual inspection because delivery has already progressed.",
        freezeThread: false,
      };
    }

    await requestOrderRefund({
      orderId: latestOrder.id,
      buyerMaskedId: user.user_type === "BUYER" ? user.masked_id : null,
      buyerPhone: senderPhone,
      reason: "Help center refund request",
    });
    await escalateSupportCase({
      user,
      issueType: "PAYMENT_REFUND",
      senderPhone,
      order: latestOrder,
      note: "Refund workflow initiated from Help Center.",
    });
    return {
      message:
        "Refund request submitted. Escrow is frozen while admin validates network and transfer fees.",
      freezeThread: false,
    };
  }

  await escalateSupportCase({
    user,
    issueType: "HUMAN_ADMIN",
    senderPhone,
    order: latestOrder,
    note: aiTriage?.summary || "User requested human admin support.",
    freezeThread: true,
  });
  return {
    message:
      "A human admin has been notified. This chat thread is now paused for manual review.",
    freezeThread: true,
  };
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
    "Choose next step by replying with:",
    "1 - Confirm and trigger M-Pesa STK prompt",
    "2 - Cancel this order",
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
    "Choose next step by replying with:",
    "1 - Confirm and trigger M-Pesa STK prompt",
    "2 - Cancel this transport order",
  ].join("\n");

const formatSellerOrderAlert = ({ payload }) =>
  {
    const lines = [
      "NEW ORDER RECEIVED!",
      "",
      `Order ID: #${payload.order.id.slice(0, 8)}`,
      `Customer Phone: ${maskBuyerPhone(payload.order.buyer_phone)}`,
      "",
      "Items Ordered:",
    ];
    const lineItems = Array.isArray(payload.lineItems) ? payload.lineItems : [];
    if (lineItems.length > 0) {
      for (const item of lineItems) {
        lines.push(
          `${Number(item.quantity || 0)}x ${item.commodityName} (KSh ${Number(
            item.lineTotalKes || 0
          ).toLocaleString()})`
        );
      }
    } else {
      lines.push(
        `${payload.quantity || 0}x ${payload.catalogItem.commodity_name} (KSh ${Number(
          payload.itemSubtotal
        ).toLocaleString()})`
      );
    }
    lines.push(
      "",
      `Total Value: KSh ${Number(payload.order.total_amount_kes).toLocaleString()} (Escrow pending payment)`
    );
    return lines.join("\n");
  };

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
    try {
      await queueOutboundMessage({
        toPhone,
        message,
        interactiveList,
        error: error.message,
      });
    } catch (_queueError) {
      // intentionally swallow queue errors in request path
    }
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
    if (Array.isArray(parsed.lineItems) && parsed.lineItems.length > 0) {
      return String(parsed.lineItems[0].commodityName || "").trim();
    }
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

const processTransportFlowStep = async ({ user, rawMessage, senderPhone, inboundLocation }) => {
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
    return locationCollectionPrompt(
      "Where are the items being picked up? Share town name or coordinates."
    );
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
    const coords = coerceCoordinates({ rawMessage: trimmed, inboundLocation });
    payload = {
      ...payload,
      pickupLabel:
        coords && trimmed === "__location_shared__"
          ? `Pinned pickup (${coords.latitude},${coords.longitude})`
          : trimmed,
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
    return locationCollectionPrompt(
      "Where are the items going? Share destination town or coordinates."
    );
  }

  if (user.current_step === "TRANSPORT_DROPOFF") {
    const coords = coerceCoordinates({ rawMessage: trimmed, inboundLocation });
    payload = {
      ...payload,
      dropoffLabel:
        coords && trimmed === "__location_shared__"
          ? `Pinned drop-off (${coords.latitude},${coords.longitude})`
          : trimmed,
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
        const lineItemResult = await client.query(
          `
            SELECT
              li.catalog_item_id,
              li.quantity,
              li.commodity_name,
              c.stock_quantity
            FROM order_line_items li
            JOIN catalog_items c ON c.id = li.catalog_item_id
            WHERE li.order_id = $1
              AND li.seller_masked_id = $2
          `,
          [order.id, user.masked_id]
        );

        let outOfStockCommodity = null;
        if (lineItemResult.rowCount > 0) {
          for (const line of lineItemResult.rows) {
            if (Number(line.stock_quantity || 0) < Number(line.quantity || 0)) {
              outOfStockCommodity = String(line.commodity_name || "").trim();
              break;
            }
          }
        } else {
          // Legacy fallback: single-item order payload.
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
            outOfStockCommodity = String(parsedPayload.commodity || "").trim() || null;
          }
        }

        if (outOfStockCommodity != null) {
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
          return { forcedOutOfStock: true, order, outOfStockCommodity };
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
        return { forcedOutOfStock: false, order, outOfStockCommodity: null };
      });

      if (stockResult.forcedOutOfStock) {
        const commodity =
          stockResult.outOfStockCommodity || extractOrderCommodity(stockResult.order);
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
      return [
        "No matching transporters found right now for that vehicle type.",
        "Choose next step by replying with:",
        "1 - Use own transport",
        "2 - Retry AgizaHub matching",
      ].join("\n");
    }

    await notifyBuyerCheckoutReady({
      order: updatePayload,
      modeLabel: `AgizaHub matched transport (${selected.label})`,
    });

    return `Vehicle selected: ${selected.label}. Broadcast sent to ${broadcastSummary.queuedDrivers} matching transporters.`;
  }

  return [
    "Logistics step reset.",
    "Choose next step by replying with:",
    "1 - I will use own transport",
    "2 - I need AgizaHub transporter matching",
  ].join("\n");
};

const parseBulkTiers = (rawValue) => {
  if (!rawValue) return [];
  try {
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        minQty: Number(item.minQty),
        discountPercent: Number(item.discountPercent),
      }))
      .filter(
        (item) =>
          Number.isFinite(item.minQty) &&
          item.minQty > 0 &&
          Number.isFinite(item.discountPercent) &&
          item.discountPercent >= 0 &&
          item.discountPercent <= 90
      )
      .sort((a, b) => b.minQty - a.minQty);
  } catch (_error) {
    return [];
  }
};

const resolveEffectiveUnitPrice = ({
  basePrice,
  quantity,
  flashDiscountPercent,
  flashDiscountEndsAt,
  bulkDiscountTiers,
}) => {
  const qty = Math.max(1, Number(quantity || 1));
  let price = Number(basePrice || 0);
  if (price <= 0) return 0;

  const now = Date.now();
  const flashEnds = flashDiscountEndsAt ? new Date(flashDiscountEndsAt).getTime() : 0;
  const flashActive =
    Number(flashDiscountPercent || 0) > 0 &&
    Number.isFinite(flashEnds) &&
    flashEnds > now;
  if (flashActive) {
    price = Number((price * (1 - Number(flashDiscountPercent) / 100)).toFixed(2));
  }

  const tiers = parseBulkTiers(bulkDiscountTiers);
  const tier = tiers.find((item) => qty >= item.minQty);
  if (tier) {
    price = Number((price * (1 - Number(tier.discountPercent) / 100)).toFixed(2));
  }
  return Number(price.toFixed(2));
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

    const effectiveUnitPrice = resolveEffectiveUnitPrice({
      basePrice: Number(catalogItem.price_per_unit || 0),
      quantity: Number(quantity || 0),
      flashDiscountPercent: Number(catalogItem.flash_discount_percent || 0),
      flashDiscountEndsAt: catalogItem.flash_discount_ends_at,
      bulkDiscountTiers: catalogItem.bulk_discount_tiers,
    });
    const itemSubtotal = Number((Number(quantity) * effectiveUnitPrice).toFixed(2));

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
          pricePerUnit: effectiveUnitPrice,
        }),
        quantity,
        buyer.delivery_address_label ||
          `${buyer.company_name || `Buyer #${buyer.masked_id}`} destination`,
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
        INSERT INTO order_line_items (
          order_id,
          catalog_item_id,
          seller_masked_id,
          commodity_name,
          unit_price_kes,
          quantity,
          line_total_kes,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `,
      [
        orderInsert.rows[0].id,
        catalogItem.id,
        seller.masked_id,
        catalogItem.commodity_name,
        effectiveUnitPrice,
        Number(quantity || 0),
        Number(itemSubtotal || 0),
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

const createOrderFromCartRequest = async ({ buyer, senderPhone, rawMessage }) =>
  transaction(async (client) => {
    const cartResult = await client.query(
      `
        SELECT
          ci.catalog_item_id,
          ci.seller_masked_id,
          ci.quantity,
          c.commodity_name,
          c.price_per_unit,
        c.flash_discount_percent,
        c.flash_discount_ends_at,
        c.bulk_discount_tiers,
          c.stock_quantity,
          c.location_label
        FROM cart_items ci
        JOIN catalog_items c ON c.id = ci.catalog_item_id
        WHERE ci.buyer_masked_id = $1
          AND c.is_active = TRUE
      `,
      [buyer.masked_id]
    );
    if (cartResult.rowCount === 0) {
      throw new Error("Cart is empty.");
    }

    const sellerIds = [...new Set(cartResult.rows.map((row) => row.seller_masked_id))];
    if (sellerIds.length !== 1) {
      throw new Error(
        "Cart checkout currently supports one seller at a time. Please keep items from one seller."
      );
    }
    const sellerMaskedId = sellerIds[0];
    const seller = await resolveUserByMaskedId(client, sellerMaskedId);
    if (!seller || seller.user_type !== "SUPPLIER") {
      throw new Error("Supplier profile not found for cart items.");
    }
    if (seller.merchant_agreement_status !== "ACCEPTED") {
      throw new Error("Supplier catalog is not active.");
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

    const lineItems = [];
    let itemSubtotal = 0;
    let totalQuantity = 0;
    for (const row of cartResult.rows) {
      const qty = Number(row.quantity || 0);
      const available = Number(row.stock_quantity || 0);
      if (qty <= 0) {
        throw new Error(`Invalid quantity in cart for item ${row.catalog_item_id}.`);
      }
      if (available < qty) {
        throw new Error(`Insufficient stock for ${row.commodity_name}.`);
      }
      const unitPrice = resolveEffectiveUnitPrice({
        basePrice: Number(row.price_per_unit || 0),
        quantity: qty,
        flashDiscountPercent: Number(row.flash_discount_percent || 0),
        flashDiscountEndsAt: row.flash_discount_ends_at,
        bulkDiscountTiers: row.bulk_discount_tiers,
      });
      const lineTotal = Number((unitPrice * qty).toFixed(2));
      lineItems.push({
        catalogItemId: Number(row.catalog_item_id),
        commodityName: row.commodity_name,
        quantity: qty,
        unitPriceKes: unitPrice,
        lineTotalKes: lineTotal,
      });
      itemSubtotal += lineTotal;
      totalQuantity += qty;
    }
    itemSubtotal = Number(itemSubtotal.toFixed(2));

    const distanceResult = await resolveRouteDistance({
      fromLat: seller.hub_latitude,
      fromLng: seller.hub_longitude,
      toLat: buyer.delivery_latitude,
      toLng: buyer.delivery_longitude,
    });
    const routeLabel = `${seller.company_name || `Seller #${seller.masked_id}`} -> ${
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
          source: "cart_checkout_command",
          sellerMaskedId: seller.masked_id,
          lineItems,
          totalItems: lineItems.length,
          totalQuantity,
        }),
        totalQuantity,
        buyer.delivery_address_label ||
          `${buyer.company_name || `Buyer #${buyer.masked_id}`} destination`,
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
        cartResult.rows[0]?.location_label || seller.company_name || "supplier-hub",
      ]
    );

    for (const item of lineItems) {
      await client.query(
        `
          INSERT INTO order_line_items (
            order_id,
            catalog_item_id,
            seller_masked_id,
            commodity_name,
            unit_price_kes,
            quantity,
            line_total_kes,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `,
        [
          orderInsert.rows[0].id,
          item.catalogItemId,
          seller.masked_id,
          item.commodityName,
          item.unitPriceKes,
          item.quantity,
          item.lineTotalKes,
        ]
      );
    }

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
          source: "cart-checkout",
        }),
      ]
    );

    return {
      order: orderInsert.rows[0],
      seller,
      buyer,
      lineItems,
      transport,
      routeLabel,
      itemSubtotal,
      quantity: totalQuantity,
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

    const amountKes = Number(order.total_amount_kes || 0);
    if (amountKes > Number(env.security.maxOrderAmountKes || 0)) {
      throw new Error(
        `Order amount exceeds per-order limit (KSh ${Number(
          env.security.maxOrderAmountKes || 0
        ).toLocaleString()})`
      );
    }

    const dailyLimit = Number(env.security.maxDailyAmountKesPerBuyer || 0);
    if (dailyLimit > 0) {
      const dailyResult = await client.query(
        `
          SELECT COALESCE(SUM(total_amount_kes), 0) AS total_kes
          FROM orders
          WHERE created_at >= NOW() - INTERVAL '24 hours'
            AND buyer_masked_id = $1
            AND payment_status IN ('PENDING_PAYMENT', 'PAID_HELD', 'REFUND_REQUESTED', 'REFUNDED')
        `,
        [user.masked_id]
      );
      const dailyTotal = Number(dailyResult.rows?.[0]?.total_kes || 0);
      if (dailyTotal + amountKes > dailyLimit) {
        throw new Error(
          `Daily payment cap exceeded (KSh ${dailyLimit.toLocaleString()}). Try again later or contact admin.`
        );
      }
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
        "Sijaelewa order. Tumia: buy item <ItemID> <Qty> (mfano: buy item 12 1.5), au andika 'buy' kuona offers.",
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

const processOnboardingStep = async ({ user, rawMessage, senderPhone, inboundLocation }) => {
  const trimmed = rawMessage.trim();

  return transaction(async (client) => {
    if (!user.user_type) {
      const selectedRole = roleFromChoice(trimmed);
      if (!selectedRole) return onboardingMenu();

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
      return MENUS.PROFILE_NAME_PROMPT();
    }

    if (user.current_step === "AWAITING_COMPANY_NAME") {
      if (trimmed.length < 2) {
        return `${MENUS.PROFILE_NAME_PROMPT()}\n\nName must be at least 2 characters.`;
      }
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
          return locationCollectionPrompt(
            "Send your delivery location coordinates (example: -1.286389,36.817223)."
          );
        }
        if (nextStep === "AWAITING_SUPPLIER_BUSINESS_TYPE") {
          return supplierBusinessTypeMenu();
        }
        if (nextStep === "AWAITING_SUPPLIER_HUB") {
          return locationCollectionPrompt(
            "Send your supplier hub coordinates (example: -0.727322,36.429387)."
          );
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
        return locationCollectionPrompt("Now send buyer delivery coordinates.");
      }
      if (nextStep === "AWAITING_SUPPLIER_BUSINESS_TYPE") {
        return supplierBusinessTypeMenu();
      }
      if (nextStep === "AWAITING_SUPPLIER_HUB") {
        return locationCollectionPrompt("Now send supplier hub coordinates.");
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
        return locationCollectionPrompt("Now send buyer delivery coordinates.");
      }
      if (nextStep === "AWAITING_SUPPLIER_BUSINESS_TYPE") {
        return supplierBusinessTypeMenu();
      }
      if (nextStep === "AWAITING_SUPPLIER_HUB") {
        return locationCollectionPrompt("Now send supplier hub coordinates.");
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
      const coords = coerceCoordinates({ rawMessage: trimmed, inboundLocation });
      if (!coords) {
        return locationCollectionPrompt("Invalid location format. Please resend your buyer location.");
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
      const coords = coerceCoordinates({ rawMessage: trimmed, inboundLocation });
      if (!coords) {
        return locationCollectionPrompt(
          "Invalid location format. Please resend your supplier hub location."
        );
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
      const summary = await upsertSupplierCatalogItemsFromParsed({
        supplierUser: user,
        parsedCatalog,
        sourceTag: "onboarding-catalog",
        client,
      });
      return `${summary.total} catalog item(s) synced for Seller #${user.masked_id} (${summary.businessType}). Buyers only see masked IDs.`;
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
      logger.info("Inbound webhook ignored by parser", {
        provider: inbound.provider || env.whatsappGateway.provider,
        reason: inbound.reason || "unknown",
      });
      return acknowledgeWebhook({
        res,
        provider: inbound.provider || env.whatsappGateway.provider,
      });
    }

    const {
      provider,
      rawMessage: inboundRawMessage,
      communicationPhone,
      senderPhone,
      senderName,
      inboundLocation,
      inboundMedia,
    } = inbound;
    const rawMessage = normalizeIncomingMessageText(inboundRawMessage);
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
      const trimmedAdmin = rawMessage.trim();

      if (adminTokenRequestPattern.test(trimmedAdmin)) {
        clearAdminPendingAction({ senderPhone });
        const issued = await issueAdminAccessToken({ adminPhone: senderPhone });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: `${adminAcknowledgeText()}\n🔐 Admin token (random one-time code): ${issued.token}\nValid for ${issued.expiresInMinutes} minutes.\nReply with: verify <code> OR just <code>.`,
        });
      }

      const verifyMatch = trimmedAdmin.match(adminTokenVerifyPattern);
      const plainCodeMatch = trimmedAdmin.match(adminTokenPlainCodePattern);
      const enteredToken = verifyMatch?.[1] || plainCodeMatch?.[1];
      if (enteredToken) {
        clearAdminPendingAction({ senderPhone });
        const verification = await verifyAdminAccessToken({
          adminPhone: senderPhone,
          token: enteredToken,
        });
        if (!verification.ok) {
          await incrementSenderFailure({ phoneNumber: senderPhone });
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: `${adminAcknowledgeText()}\nInvalid or expired token. Request a new one with: admin token`,
          });
        }
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: `${adminAcknowledgeText()}\n✅ Verified. Privileged session active for ${verification.verifiedForMinutes} minutes.\n\n${adminCommandMenu()}`,
        });
      }

      if (adminLogoutPattern.test(trimmedAdmin)) {
        clearAdminPendingAction({ senderPhone });
        await revokeAdminSession({ adminPhone: senderPhone });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: `${adminAcknowledgeText()}\nAdmin session closed.`,
        });
      }

      const adminSessionOk =
        !env.admin.requireToken || (await isAdminSessionActive({ adminPhone: senderPhone }));
      if (!adminSessionOk) {
        clearAdminPendingAction({ senderPhone });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: `${adminAcknowledgeText()}\n🔒 For privileged access, request token with: admin token`,
        });
      }

      if (isExplicitAdminCommand(trimmedAdmin)) {
        clearAdminPendingAction({ senderPhone });
      }

      const broadcastMatch = rawMessage.match(adminBroadcastBuyersPattern);
      if (broadcastMatch) {
        clearAdminPendingAction({ senderPhone });
        const promoText = String(broadcastMatch[1] || "").trim();
        if (!promoText) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: `${adminAcknowledgeText()}\nUse: broadcast buyers <message>`,
          });
        }
        const buyers = await query(
          `
            SELECT DISTINCT phone_number
            FROM platform_users
            WHERE user_type = 'BUYER'
              AND current_step = 'COMPLETED'
              AND phone_number IS NOT NULL
          `
        );
        let sentCount = 0;
        for (const row of buyers.rows) {
          const ok = await safeNotifyWhatsappPhone({
            toPhone: row.phone_number,
            message: `📣 AgizaHub Promo\n${promoText}`,
          });
          if (ok) sentCount += 1;
        }
        await query(
          `
            INSERT INTO promo_broadcasts (
              created_by_phone,
              target_role,
              message_text,
              status,
              sent_count,
              created_at,
              sent_at
            )
            VALUES ($1, 'BUYER', $2, 'SENT', $3, NOW(), NOW())
          `,
          [senderPhone, promoText, sentCount]
        );
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: `${adminAcknowledgeText()}\nPromo broadcast sent to ${sentCount} buyers.`,
        });
      }

      const broadcastAllMatch = rawMessage.match(adminBroadcastAllPattern);
      if (broadcastAllMatch) {
        clearAdminPendingAction({ senderPhone });
        const promoText = String(broadcastAllMatch[1] || "").trim();
        if (!promoText) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: `${adminAcknowledgeText()}\nUse: broadcast all <message>`,
          });
        }
        const users = await query(
          `
            SELECT DISTINCT phone_number
            FROM platform_users
            WHERE current_step = 'COMPLETED'
              AND phone_number IS NOT NULL
          `
        );
        let sentCount = 0;
        for (const row of users.rows) {
          const ok = await safeNotifyWhatsappPhone({
            toPhone: row.phone_number,
            message: `📣 AgizaHub Notice\n${promoText}`,
          });
          if (ok) sentCount += 1;
        }
        await query(
          `
            INSERT INTO promo_broadcasts (
              created_by_phone,
              target_role,
              message_text,
              status,
              sent_count,
              created_at,
              sent_at
            )
            VALUES ($1, 'ALL', $2, 'SENT', $3, NOW(), NOW())
          `,
          [senderPhone, promoText, sentCount]
        );
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: `${adminAcknowledgeText()}\nBroadcast sent to ${sentCount} users.`,
        });
      }

      const adminResponse = await handleAdminCommand(rawMessage, senderPhone);
      if (adminResponse) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: `${adminAcknowledgeText()}\n${adminResponse}`,
        });
      }
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `${adminAcknowledgeText()}\n${adminCommandMenu()}`,
      });
    }

    const abuse = await registerSenderMessage({ phoneNumber: senderPhone });
    if (!abuse.allowed) {
      if (abuse.newlyMuted || abuse.newlyBanned) {
        await sendDisputeEscalationAlert({
          orderId: null,
          issueType: "ABUSE_PREVENTION",
          reporterPhone: senderPhone,
          note: abuse.newlyBanned
            ? "Auto-ban triggered after repeated flooding."
            : "Auto-mute triggered due to message flood threshold.",
          payload: {
            blockedReason: abuse.blockedReason,
            mutedUntil: abuse.mutedUntil || null,
            bannedUntil: abuse.bannedUntil || null,
          },
        });
      }
      return respondToUser({
        res,
        provider,
        senderPhone,
        message:
          abuse.blockedReason === "BANNED"
            ? "Your account is temporarily blocked due to abuse protection rules. Contact admin."
            : "Too many messages in a short time. Please wait a few minutes before trying again.",
      });
    }

    const user = await transaction(async (client) =>
      ensureUserRecord(client, communicationPhone)
    );

    if (!user.phone_verified) {
      const trimmed = rawMessage.trim();
      const otpMatch = trimmed.match(/^(\d{4})$/);
      const expiresAt = user.registration_otp_expires_at
        ? new Date(user.registration_otp_expires_at)
        : null;
      const otpActive = Boolean(
        user.registration_otp_hash && expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt > new Date()
      );

      if (user.current_step === "AWAITING_REGISTRATION_OTP" && otpMatch && otpActive) {
        const verified = await bcrypt.compare(otpMatch[1], user.registration_otp_hash);
        if (verified) {
          await query(
            `
              UPDATE platform_users
              SET phone_verified = TRUE,
                  registration_otp_hash = NULL,
                  registration_otp_expires_at = NULL,
                  registration_otp_attempts = 0,
                  current_step = 'START',
                  updated_at = NOW()
              WHERE id = $1
            `,
            [user.id]
          );
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: MENUS.WELCOME_ROLE_SELECT(),
          });
        }

        await incrementSenderFailure({ phoneNumber: senderPhone });
        await query(
          `
            UPDATE platform_users
            SET registration_otp_attempts = registration_otp_attempts + 1,
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id]
        );
        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            "Invalid verification code. Reply with the 4-digit OTP sent by AgizaHub (or type OTP to resend).",
        });
      }

      const shouldResendOtp =
        !otpActive ||
        user.current_step !== "AWAITING_REGISTRATION_OTP" ||
        /^(otp|verify|thibitisha|resend|tuma tena)$/i.test(trimmed);

      let messageOtp = null;
      if (shouldResendOtp) {
        const { otp, otpHash } = await generateRegistrationOtp();
        messageOtp = otp;
        await query(
          `
            UPDATE platform_users
            SET registration_otp_hash = $2,
                registration_otp_expires_at = NOW() + INTERVAL '10 minutes',
                registration_otp_attempts = 0,
                current_step = 'AWAITING_REGISTRATION_OTP',
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id, otpHash]
        );
      }

      return respondToUser({
        res,
        provider,
        senderPhone,
        message: messageOtp
          ? `Security check: verify this phone with OTP ${messageOtp}. It expires in 10 minutes.`
          : "Security check pending. Reply with your 4-digit OTP to verify this phone (or type OTP to resend).",
      });
    }

    if (
      user.user_type === "SUPPLIER" &&
      merchantAgreementAcceptPattern.test(rawMessage.trim()) &&
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
            ? locationCollectionPrompt("Agreement accepted. Send supplier hub coordinates.")
            : "Agreement accepted. Store active. Add catalog with: Item, Price",
      });
    }

    if (user.user_type === "SUPPLIER" && termsCommandPattern.test(rawMessage.trim())) {
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: merchantAgreementMessage(),
      });
    }

    if (supportOrderPattern.test(rawMessage)) {
      const match = rawMessage.match(supportOrderPattern);
      const supportOrderId = normalizeOrderIdFromText(match[1]);
      await query(
        `
          UPDATE platform_users
          SET current_step = 'AWAITING_HELP_SELECTION',
              support_ticket_context = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          user.id,
          JSON.stringify({
            orderId: supportOrderId,
            source: "support-command",
          }),
        ]
      );
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Support context loaded for order #${supportOrderId.slice(0, 8)}.\n\n${helpCenterMenu()}`,
        interactiveList: helpCenterInteractiveList(),
      });
    }

    if (helpCommandPattern.test(rawMessage.trim())) {
      await query(
        `
          UPDATE platform_users
          SET current_step = 'AWAITING_HELP_SELECTION',
              support_ticket_context = '{}'::jsonb,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: helpCenterMenu(),
        interactiveList: helpCenterInteractiveList(),
      });
    }

    if (user.bot_thread_frozen && user.current_step !== "AWAITING_HELP_SELECTION") {
      return respondToUser({
        res,
        provider,
        senderPhone,
        message:
          "Your case is currently with a human admin reviewer. Type help or msaada to view support options again.",
      });
    }

    if (user.current_step === "AWAITING_HELP_SELECTION") {
      let supportContext = user.support_ticket_context || {};
      if (typeof supportContext === "string") {
        try {
          supportContext = JSON.parse(supportContext);
        } catch (_error) {
          supportContext = {};
        }
      }
      const support = await processHelpSelection({
        user,
        senderPhone,
        rawMessage,
        explicitOrderId: supportContext.orderId || null,
      });
      await query(
        `
          UPDATE platform_users
          SET current_step = CASE WHEN $2 THEN 'AWAITING_ADMIN_INTERVENTION' ELSE 'COMPLETED' END,
              support_ticket_context = CASE WHEN $2 THEN support_ticket_context ELSE '{}'::jsonb END,
              bot_thread_frozen = CASE WHEN $2 THEN TRUE ELSE FALSE END,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id, Boolean(support.freezeThread)]
      );
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: support.message,
        interactiveList: support.interactiveList || null,
      });
    }

    if (emotionalEscalationPattern.test(rawMessage)) {
      await escalateSupportCase({
        user,
        issueType: "HUMAN_ADMIN",
        senderPhone,
        order: null,
        note: "Emotion/risk keyword detected in message.",
        freezeThread: true,
      });
      return respondToUser({
        res,
        provider,
        senderPhone,
        message:
          "Your message has been escalated to a human admin for immediate review. We have paused bot automation on this thread.",
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
      let pending = user.pending_transport_payload || {};
      if (typeof pending === "string") {
        try {
          pending = JSON.parse(pending);
        } catch (_error) {
          pending = {};
        }
      }

      if (selection?.rowNumber) {
        const rowOption = Array.isArray(pending.options) ? pending.options[selection.rowNumber - 1] : null;
        if (rowOption) {
          selection = {
            catalogItemId: Number(rowOption.catalogItemId),
            sellerMaskedId: String(rowOption.sellerMaskedId),
            rowNumber: selection.rowNumber,
          };
        } else {
          selection = null;
        }
      }

      if (!selection && rawMessage.trim() === "1") {
        const firstOption = Array.isArray(pending.options) ? pending.options[0] : null;
        if (firstOption) {
          selection = {
            catalogItemId: Number(firstOption.catalogItemId),
            sellerMaskedId: String(firstOption.sellerMaskedId),
            rowNumber: 1,
          };
        }
      }
      if (!selection) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            "Reply with row number (1..10), or selection ID (search_select_<catalog>_<seller>), or 2 to cancel.",
        });
      }

      const rowResult = await query(
        `
          SELECT
            c.id AS catalog_item_id,
            c.seller_masked_id,
            c.commodity_name,
            c.price_per_unit,
            c.flash_discount_percent,
            c.flash_discount_ends_at,
            c.bulk_discount_tiers,
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

      const selectedRow = rowResult.rows[0];
      selectedRow.effectivePrice = resolveEffectiveUnitPrice({
        basePrice: Number(selectedRow.price_per_unit || 0),
        quantity: 1,
        flashDiscountPercent: Number(selectedRow.flash_discount_percent || 0),
        flashDiscountEndsAt: selectedRow.flash_discount_ends_at,
        bulkDiscountTiers: selectedRow.bulk_discount_tiers,
      });

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
        message: buildSearchQuantityPrompt({ row: selectedRow }),
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

      const qty = parseFlexibleQuantity(rawMessage.trim());
      if (!Number.isFinite(qty) || qty <= 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Please send a valid quantity (examples: 1, 1.5, 1/2) or 0 to cancel.",
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
          message: [
            "Please choose a valid option:",
            "1 - Deposit now (trigger STK prompt)",
            "2 - Cancel order",
          ].join("\n"),
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
        inboundLocation,
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

    if (
      user.current_step === "AWAITING_CATALOG_INGESTION_MODE" ||
      user.current_step === "AWAITING_CATALOG_TEXT_BULK" ||
      user.current_step === "AWAITING_CATALOG_DOCUMENT" ||
      user.current_step === "AWAITING_CATALOG_IMAGE"
    ) {
      const response = await processSupplierCatalogIngestionStep({
        user,
        rawMessage,
        senderPhone,
        inboundMedia,
      });
      if (response) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: response.message,
          interactiveList: response.interactiveList || null,
        });
      }
    }

    if (
      user.current_step === "AWAITING_SELLER_ITEM_NAME" ||
      user.current_step === "AWAITING_SELLER_ITEM_UNIT" ||
      user.current_step === "AWAITING_SELLER_ITEM_PRICE" ||
      user.current_step === "AWAITING_SELLER_ITEM_STOCK" ||
      user.current_step === "AWAITING_SELLER_ITEM_CONTINUE"
    ) {
      const response = await processSupplierItemWizardStep({
        user,
        rawMessage,
        senderPhone,
      });
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: response || "Catalog wizard state reset. Type catalog wizard to restart.",
      });
    }

    if (!user.user_type || user.current_step !== "COMPLETED") {
      const onboardingResponse = await processOnboardingStep({
        user,
        rawMessage,
        senderPhone,
        inboundLocation,
      });
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: onboardingResponse,
      });
    }

    if (user.user_type === "SUPPLIER" && sellerItemWizardStartPattern.test(rawMessage.trim())) {
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: await startSupplierItemWizard({ user }),
      });
    }

    if (user.user_type === "SUPPLIER" && supplierCatalogTriggerPattern.test(rawMessage.trim())) {
      await query(
        `
          UPDATE platform_users
          SET current_step = 'AWAITING_CATALOG_INGESTION_MODE',
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: catalogIngestionMenu(),
        interactiveList: catalogIngestionInteractiveList(),
      });
    }

    if (transportCommandPattern.test(rawMessage.trim())) {
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

    if (buyOffersViewPattern.test(rawMessage.trim())) {
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: await listCatalogOffersMessage(),
      });
    }

    if (categoriesPattern.test(rawMessage.trim())) {
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: await listCategoriesMessage(),
      });
    }

    if (categorySelectPattern.test(rawMessage.trim())) {
      const selected = rawMessage.match(categorySelectPattern);
      const categoryType = await resolveCategoryType(selected?.[1]);
      if (!categoryType) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Invalid category. Use: categories, then category <number>",
        });
      }
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: await listCatalogByCategoryMessage({ categoryType }),
      });
    }

    if (comparePattern.test(rawMessage.trim())) {
      const match = rawMessage.match(comparePattern);
      const searchTerm = String(match?.[1] || "").trim();
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: await compareItemPricesMessage({ searchTerm }),
      });
    }

    if (detailPattern.test(rawMessage.trim())) {
      const match = rawMessage.match(detailPattern);
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: await productDetailCardMessage({
          catalogItemId: Number(match?.[1]),
        }),
      });
    }

    if (pointsPattern.test(rawMessage.trim()) && user.user_type === "BUYER") {
      const points = await getLoyaltyBalance({ buyerMaskedId: user.masked_id });
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Loyalty balance: ${points.toLocaleString()} points.`,
      });
    }

    if (referralCodePattern.test(rawMessage.trim()) && user.user_type === "BUYER") {
      const code = await ensureReferralCode({ userMaskedId: user.masked_id });
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Your referral code: ${code}\nShare this. New buyers can use: refer ${code}`,
      });
    }

    if (referralApplyPattern.test(rawMessage.trim()) && user.user_type === "BUYER") {
      const refMatch = rawMessage.match(referralApplyPattern);
      const code = String(refMatch?.[1] || "").trim();
      const codeResult = await query(
        `
          SELECT owner_masked_id
          FROM referral_codes
          WHERE referral_code = $1
          LIMIT 1
        `,
        [code]
      );
      if (codeResult.rowCount === 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Invalid referral code.",
        });
      }
      const referrerMaskedId = codeResult.rows[0].owner_masked_id;
      if (referrerMaskedId === user.masked_id) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "You cannot refer yourself.",
        });
      }
      const existingReferral = await query(
        `
          SELECT id FROM referrals
          WHERE referred_masked_id = $1
          LIMIT 1
        `,
        [user.masked_id]
      );
      if (existingReferral.rowCount > 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Referral already linked for your account.",
        });
      }

      await transaction(async (client) => {
        await client.query(
          `
            INSERT INTO referrals (
              referrer_masked_id,
              referred_masked_id,
              reward_points_granted,
              created_at
            )
            VALUES ($1, $2, 50, NOW())
          `,
          [referrerMaskedId, user.masked_id]
        );
        await client.query(
          `
            INSERT INTO loyalty_wallets (buyer_masked_id, points_balance, updated_at)
            VALUES ($1, 50, NOW())
            ON CONFLICT (buyer_masked_id)
            DO UPDATE SET
              points_balance = loyalty_wallets.points_balance + 50,
              updated_at = NOW()
          `,
          [referrerMaskedId]
        );
        await client.query(
          `
            INSERT INTO loyalty_points_ledger (
              buyer_masked_id,
              points_delta,
              reason,
              created_at
            )
            VALUES ($1, 50, 'Referral reward', NOW())
          `,
          [referrerMaskedId]
        );
      });
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: "Referral linked successfully. Reward points credited to inviter.",
      });
    }

    if (user.user_type === "BUYER" && searchCommandPrefixPattern.test(rawMessage)) {
      const searchTerm = rawMessage.replace(searchCommandPrefixPattern, "").trim();
      if (!searchTerm) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            "Use: search <product name> or tafuta <product name>. Example: search maize flour",
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

    if (user.user_type === "BUYER" && searchOnlyPattern.test(rawMessage.trim())) {
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: [
          "Search needs a product name.",
          "Examples:",
          "- search charger",
          "- search maize flour",
          "- search tv",
          "",
          "Tip: type 'buy' to see current offers table.",
        ].join("\n"),
      });
    }

    if (user.user_type === "SUPPLIER" && listPricesPattern.test(rawMessage.trim())) {
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: await listSupplierCatalogPricesMessage({
          sellerMaskedId: user.masked_id,
        }),
      });
    }

    if (user.user_type === "SUPPLIER" && priceUpdatePrefixPattern.test(rawMessage.trim())) {
      const parsedPriceUpdate = parseUpdatePriceCommand(rawMessage);
      if (!parsedPriceUpdate) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            "Use: /update price <catalog_item_id> <new_price> or badili bei <catalog_item_id> <new_price>. Example: /update price 2 340. Type 'my prices' or 'bei zangu' to see item IDs.",
        });
      }

      const updateResult = await query(
        `
          UPDATE catalog_items
          SET price_per_unit = $3,
              is_active = TRUE,
              catalog_metadata = COALESCE(catalog_metadata, '{}'::jsonb) || $4::jsonb,
              updated_at = NOW()
          WHERE id = $1
            AND seller_masked_id = $2
          RETURNING id, commodity_name, price_per_unit
        `,
        [
          parsedPriceUpdate.catalogItemId,
          user.masked_id,
          parsedPriceUpdate.newPrice,
          JSON.stringify({
            source: "supplier-price-command",
            updated_by_phone: senderPhone,
            updated_at: new Date().toISOString(),
          }),
        ]
      );

      if (updateResult.rowCount === 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            "Price update failed. Item ID not found under your catalog. Type 'my prices' to view valid IDs.",
        });
      }

      if (
        Number(updateResult.rows[0].previous_stock || 0) <= 0 &&
        Number(updateResult.rows[0].stock_quantity || 0) > 0
      ) {
        await notifyBackInStockAlerts({
          catalogItemId: Number(updateResult.rows[0].id),
        });
      }

      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Price updated successfully. ID ${updateResult.rows[0].id} (${updateResult.rows[0].commodity_name}) is now KSh ${Number(
          updateResult.rows[0].price_per_unit
        ).toLocaleString()}. New buyer checkouts will use this updated price instantly.`,
      });
    }

    if (user.user_type === "SUPPLIER" && deleteItemPattern.test(rawMessage.trim())) {
      const match = rawMessage.match(deleteItemPattern);
      const itemId = Number(match?.[1]);
      const deleted = await query(
        `
          UPDATE catalog_items
          SET is_active = FALSE,
              updated_at = NOW()
          WHERE id = $1
            AND seller_masked_id = $2
          RETURNING id, commodity_name
        `,
        [itemId, user.masked_id]
      );
      if (deleted.rowCount === 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Item not found in your catalog.",
        });
      }
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Item removed: ${deleted.rows[0].commodity_name} (ID ${deleted.rows[0].id}).`,
      });
    }

    if (user.user_type === "SUPPLIER" && updateStockThresholdPattern.test(rawMessage.trim())) {
      const match = rawMessage.match(updateStockThresholdPattern);
      const itemId = Number(match?.[1]);
      const threshold = Number(match?.[2]);
      const updated = await query(
        `
          UPDATE catalog_items
          SET low_stock_threshold = $3,
              updated_at = NOW()
          WHERE id = $1
            AND seller_masked_id = $2
          RETURNING commodity_name, low_stock_threshold
        `,
        [itemId, user.masked_id, threshold]
      );
      if (updated.rowCount === 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Item not found for threshold update.",
        });
      }
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Low stock threshold updated for ${updated.rows[0].commodity_name}: ${updated.rows[0].low_stock_threshold}.`,
      });
    }

    if (user.user_type === "SUPPLIER" && flashSalePattern.test(rawMessage.trim())) {
      const match = rawMessage.match(flashSalePattern);
      const itemId = Number(match?.[1]);
      const discountPercent = Number(match?.[2]);
      const hours = Number(match?.[3]);
      if (
        !Number.isFinite(itemId) ||
        !Number.isFinite(discountPercent) ||
        !Number.isFinite(hours) ||
        discountPercent <= 0 ||
        discountPercent > 90 ||
        hours <= 0
      ) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Use: flash sale <item_id> <discount_percent> <hours>. Example: flash sale 12 15 6",
        });
      }
      const updated = await query(
        `
          UPDATE catalog_items
          SET flash_discount_percent = $3,
              flash_discount_ends_at = NOW() + ($4::text || ' hours')::interval,
              updated_at = NOW()
          WHERE id = $1
            AND seller_masked_id = $2
          RETURNING id, commodity_name, flash_discount_percent, flash_discount_ends_at
        `,
        [itemId, user.masked_id, discountPercent, String(hours)]
      );
      if (updated.rowCount === 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Item not found for flash sale update.",
        });
      }
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Flash sale enabled: ${updated.rows[0].commodity_name} at ${Number(
          updated.rows[0].flash_discount_percent
        )}% discount until ${new Date(updated.rows[0].flash_discount_ends_at).toISOString()}.`,
      });
    }

    if (user.user_type === "SUPPLIER" && promoteItemPattern.test(rawMessage.trim())) {
      const match = rawMessage.match(promoteItemPattern);
      const itemId = Number(match?.[1]);
      const hours = Number(match?.[2]);
      if (!Number.isFinite(itemId) || !Number.isFinite(hours) || hours <= 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Use: promote item <item_id> <hours>. Example: promote item 12 24",
        });
      }
      const updated = await query(
        `
          UPDATE catalog_items
          SET promoted_until = NOW() + ($3::text || ' hours')::interval,
              updated_at = NOW()
          WHERE id = $1
            AND seller_masked_id = $2
          RETURNING id, commodity_name, promoted_until
        `,
        [itemId, user.masked_id, String(hours)]
      );
      if (updated.rowCount === 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Item not found for promotion.",
        });
      }
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `${updated.rows[0].commodity_name} promoted until ${new Date(
          updated.rows[0].promoted_until
        ).toISOString()}.`,
      });
    }

    if (user.user_type === "SUPPLIER" && payoutRequestPattern.test(rawMessage.trim())) {
      const match = rawMessage.match(payoutRequestPattern);
      const amount = Number(match?.[1]);
      if (!Number.isFinite(amount) || amount <= 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Invalid payout amount. Use: payout request <amount>",
        });
      }
      await query(
        `
          INSERT INTO seller_payout_requests (
            seller_masked_id,
            amount_kes,
            status,
            created_at,
            updated_at
          )
          VALUES ($1, $2, 'PENDING', NOW(), NOW())
        `,
        [user.masked_id, amount]
      );
      return respondToUser({
        res,
        provider,
        senderPhone,
        message:
          "Payout request received and queued for admin approval. Admin can approve with: payout approve <request_id>.",
      });
    }

    if (user.user_type === "SUPPLIER" && addStockPrefixPattern.test(rawMessage)) {
      const parsedAdd = parseAddStockCommand(rawMessage);
      if (!parsedAdd || parsedAdd.quantity <= 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            "Use: Add stock <quantity> <item name> or Ongeza stock <quantity> <item>. Example: Add stock 50 Sugar",
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
          RETURNING id, commodity_name, stock_quantity, (stock_quantity - $3) AS previous_stock
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
        ).toLocaleString()} units.${
          Number(updateResult.rows[0].previous_stock || 0) <= 0 &&
          Number(updateResult.rows[0].stock_quantity || 0) > 0
            ? " Back-in-stock alerts are being sent."
            : ""
        }`,
      });
    }

    if (user.user_type === "SUPPLIER" && addOrUpdateInventoryPattern.test(rawMessage)) {
      const parsedNewItem = parseInventoryNewItemCommand(rawMessage);
      if (!parsedNewItem) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            "Use: Add new item: Premium Milk 1L, Price 150, Stock 20 (or Ongeza bidhaa mpya: ...)",
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

      let affectedItem = null;
      if (existingItem.rowCount > 0) {
        const updated = await query(
          `
            UPDATE catalog_items
            SET price_per_unit = $2,
                stock_quantity = stock_quantity + $3,
                is_active = TRUE,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, stock_quantity, (stock_quantity - $3) AS previous_stock
          `,
          [existingItem.rows[0].id, Math.round(parsedNewItem.price), parsedNewItem.stockQuantity]
        );
        affectedItem = updated.rows[0] || null;
      } else {
        const inserted = await query(
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
            RETURNING id, stock_quantity
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
        affectedItem = inserted.rows[0]
          ? { ...inserted.rows[0], previous_stock: 0 }
          : null;
      }

      if (
        affectedItem &&
        Number(affectedItem.previous_stock || 0) <= 0 &&
        Number(affectedItem.stock_quantity || 0) > 0
      ) {
        await notifyBackInStockAlerts({
          catalogItemId: Number(affectedItem.id),
        });
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
        const summary = await upsertSupplierCatalogItemsFromParsed({
          supplierUser: user,
          parsedCatalog,
          sourceTag: "supplier-chat-catalog",
        });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: `Catalog synced. Added ${summary.created}, updated ${summary.updated} (${summary.businessType}).`,
        });
      }
    }

    if (user.user_type === "BUYER") {
      if (languagePattern.test(rawMessage.trim())) {
        const match = rawMessage.match(languagePattern);
        const chosen = String(match?.[1] || "").toLowerCase();
        const language = ["sw", "swahili"].includes(chosen) ? "SW" : "EN";
        await query(
          `
            UPDATE platform_users
            SET preferred_language = $2,
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id, language]
        );
        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            language === "SW"
              ? "Lugha imewekwa Kiswahili."
              : "Language set to English.",
        });
      }

      if (setAddressPattern.test(rawMessage.trim())) {
        const match = rawMessage.match(setAddressPattern);
        const address = String(match?.[1] || "")
          .trim()
          .slice(0, 160);
        if (!address) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: "Use: set address <your delivery address>",
          });
        }
        await query(
          `
            UPDATE platform_users
            SET delivery_address_label = $2,
                updated_at = NOW()
            WHERE id = $1
          `,
          [user.id, address]
        );
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: `Saved delivery address: ${address}`,
        });
      }

      if (myAddressPattern.test(rawMessage.trim())) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: user.delivery_address_label
            ? `Your saved delivery address: ${user.delivery_address_label}`
            : "No saved delivery address yet. Use: set address <text>",
        });
      }

      if (restockAlertPattern.test(rawMessage.trim())) {
        const match = rawMessage.match(restockAlertPattern);
        const catalogItemId = Number(match?.[1]);
        await subscribeBackInStockAlert({
          buyerMaskedId: user.masked_id,
          catalogItemId,
        });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: `Back-in-stock alert saved for item ID ${catalogItemId}.`,
        });
      }

      if (wishlistAddPattern.test(rawMessage.trim())) {
        const match = rawMessage.match(wishlistAddPattern);
        await addWishlistItem({
          buyerMaskedId: user.masked_id,
          catalogItemId: Number(match?.[1]),
        });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Saved to wishlist.",
        });
      }

      if (wishlistRemovePattern.test(rawMessage.trim())) {
        const match = rawMessage.match(wishlistRemovePattern);
        await removeWishlistItem({
          buyerMaskedId: user.masked_id,
          catalogItemId: Number(match?.[1]),
        });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Removed from wishlist.",
        });
      }

      if (wishlistListPattern.test(rawMessage.trim())) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: await wishlistSummaryMessage({ buyerMaskedId: user.masked_id }),
        });
      }

      if (cartAddPattern.test(rawMessage.trim())) {
        const match = rawMessage.match(cartAddPattern);
        try {
          await addToCart({
            buyerMaskedId: user.masked_id,
            catalogItemId: Number(match?.[1]),
            quantity: Number(match?.[2]),
          });
        } catch (error) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: error.message,
          });
        }
        const items = await getCartItemsForBuyer({ buyerMaskedId: user.masked_id });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: cartSummaryMessage({ items }),
        });
      }

      if (cartViewPattern.test(rawMessage.trim())) {
        const items = await getCartItemsForBuyer({ buyerMaskedId: user.masked_id });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: cartSummaryMessage({ items }),
        });
      }

      if (cartClearPattern.test(rawMessage.trim())) {
        await clearCart({ buyerMaskedId: user.masked_id });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Cart cleared.",
        });
      }

      if (cartCheckoutPattern.test(rawMessage.trim())) {
        const items = await getCartItemsForBuyer({ buyerMaskedId: user.masked_id });
        if (items.length === 0) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: "Cart is empty.",
          });
        }
        let payload = null;
        try {
          payload = await createOrderFromCartRequest({
            buyer: user,
            senderPhone,
            rawMessage: "checkout",
          });
        } catch (error) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: error.message,
          });
        }
        await notifySellerForLogisticsDecision({ payload });
        await clearCart({ buyerMaskedId: user.masked_id });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            "Cart checkout created and sent to seller for stock/logistics confirmation. Payment prompt will follow confirmation.",
        });
      }

      if (reorderPattern.test(rawMessage.trim())) {
        const lastOrderResult = await query(
          `
            SELECT catalog_item_id, supplier_masked_id, quantity
            FROM orders
            WHERE buyer_masked_id = $1
              AND catalog_item_id IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1
          `,
          [user.masked_id]
        );
        if (lastOrderResult.rowCount === 0) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: "No previous catalog order found for reorder.",
          });
        }
        const last = lastOrderResult.rows[0];
        const payload = await createOrderFromCatalogRequest({
          buyer: user,
          senderPhone,
          rawMessage: "reorder",
          sellerMaskedId: last.supplier_masked_id,
          quantity: Number(last.quantity || 1),
          catalogItemId: Number(last.catalog_item_id),
        });
        await notifySellerForLogisticsDecision({ payload });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Repeat order placed. Seller has been notified for confirmation.",
        });
      }

      if (statusPattern.test(rawMessage.trim())) {
        const statusMatch = rawMessage.match(statusPattern);
        const explicitOrder = statusMatch?.[1]
          ? normalizeOrderIdFromText(statusMatch[1])
          : null;
        const statusResult = await query(
          `
            SELECT id, payment_status, settlement_status, distribution_status, order_progress_status
            FROM orders
            WHERE buyer_masked_id = $1
              AND ($2::text IS NULL OR id::text = $2)
            ORDER BY created_at DESC
            LIMIT 1
          `,
          [user.masked_id, explicitOrder]
        );
        if (statusResult.rowCount === 0) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: "Order not found for status.",
          });
        }
        const o = statusResult.rows[0];
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: [
            `Order #${o.id.slice(0, 8)} status`,
            `Progress: ${o.order_progress_status}`,
            `Payment: ${o.payment_status}`,
            `Settlement: ${o.settlement_status}`,
            `Distribution: ${o.distribution_status}`,
          ].join("\n"),
        });
      }

      if (schedulePattern.test(rawMessage.trim())) {
        const match = rawMessage.match(schedulePattern);
        const orderId = normalizeOrderIdFromText(match?.[1]);
        const datetimeRaw = String(match?.[2] || "").trim();
        const scheduledFor = new Date(datetimeRaw);
        if (!Number.isFinite(scheduledFor.getTime())) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message:
              "Invalid schedule date/time. Example: schedule <orderId> 2026-06-25 09:30",
          });
        }
        await query(
          `
            UPDATE orders
            SET scheduled_for = $3,
                updated_at = NOW()
            WHERE id = $1
              AND buyer_masked_id = $2
          `,
          [orderId, user.masked_id, scheduledFor.toISOString()]
        );
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: `Order #${orderId.slice(0, 8)} scheduled for ${scheduledFor.toISOString()}.`,
        });
      }

      if (ratePattern.test(rawMessage.trim())) {
        const match = rawMessage.match(ratePattern);
        const orderId = normalizeOrderIdFromText(match?.[1]);
        const rating = Number(match?.[2]);
        const comment = String(match?.[3] || "").trim() || null;
        const orderResult = await query(
          `
            SELECT id, buyer_masked_id, supplier_masked_id, order_progress_status
            FROM orders
            WHERE id = $1
              AND buyer_masked_id = $2
            LIMIT 1
          `,
          [orderId, user.masked_id]
        );
        if (orderResult.rowCount === 0) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: "Order not found for rating.",
          });
        }
        const order = orderResult.rows[0];
        if (!["DELIVERED"].includes(order.order_progress_status)) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: "You can rate only after delivery is marked complete.",
          });
        }
        await query(
          `
            INSERT INTO seller_ratings (
              order_id,
              buyer_masked_id,
              seller_masked_id,
              rating,
              comment,
              created_at
            )
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (order_id, buyer_masked_id)
            DO UPDATE SET
              rating = EXCLUDED.rating,
              comment = EXCLUDED.comment
          `,
          [order.id, user.masked_id, order.supplier_masked_id, rating, comment]
        );
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Rating submitted. Asante sana.",
        });
      }

      const itemBuyMatch = rawMessage.match(buyByItemPattern);
      if (itemBuyMatch) {
        const catalogItemId = Number(itemBuyMatch[1]);
        const qty = parseFlexibleQuantity(itemBuyMatch[2]);
        if (!Number.isFinite(catalogItemId) || catalogItemId <= 0 || !Number.isFinite(qty) || qty <= 0) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: "Use: buy item <item_id> <qty>. Examples: buy item 12 1.5 OR buy item 12 1/2",
          });
        }

        const itemOwner = await query(
          `
            SELECT seller_masked_id
            FROM catalog_items
            WHERE id = $1
              AND is_active = TRUE
            LIMIT 1
          `,
          [catalogItemId]
        );
        if (itemOwner.rowCount > 0) {
          const payload = await createOrderFromCatalogRequest({
            buyer: user,
            senderPhone,
            rawMessage,
            sellerMaskedId: itemOwner.rows[0].seller_masked_id,
            quantity: qty,
            catalogItemId,
          });
          await notifySellerForLogisticsDecision({ payload });
          return respondToUser({
            res,
            provider,
            senderPhone,
            message:
              "Order submitted. Waiting seller stock + logistics confirmation before payment prompt.",
          });
        }
      }

      const buyMatch = rawMessage.match(supplierBuyPattern);
      if (buyMatch) {
        const qty = parseFlexibleQuantity(buyMatch[2]);
        if (!Number.isFinite(qty) || qty <= 0) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: "Invalid quantity. Example: buy 14528 1.5 or buy 14528 1/2",
          });
        }
        const payload = await createOrderFromCatalogRequest({
          buyer: user,
          senderPhone,
          rawMessage,
          sellerMaskedId: buyMatch[1],
          quantity: qty,
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

      const refundMatch = rawMessage.match(refundPattern);
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

      const cancelMatch = rawMessage.match(/^cancel\s+([a-zA-Z0-9-]+)(?:\s+(.+))?$/i);
      if (cancelMatch) {
        const orderId = normalizeOrderIdFromText(cancelMatch[1]);
        const orderResult = await query(
          `
            SELECT id, payment_status
            FROM orders
            WHERE id = $1
              AND buyer_masked_id = $2
            LIMIT 1
          `,
          [orderId, user.masked_id]
        );
        if (orderResult.rowCount === 0) {
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: "Order not found for cancellation.",
          });
        }
        const paymentStatus = orderResult.rows[0].payment_status;
        if (paymentStatus === "PENDING_PAYMENT") {
          await query(
            `
              UPDATE orders
              SET payment_status = 'PAYMENT_FAILED',
                  order_progress_status = 'CANCELLED',
                  dispute_reason = COALESCE($2, dispute_reason),
                  updated_at = NOW()
              WHERE id = $1
            `,
            [orderId, cancelMatch[2] || "Buyer canceled before payment"]
          );
          return respondToUser({
            res,
            provider,
            senderPhone,
            message: "Order cancelled before payment.",
          });
        }
        await requestOrderRefund({
          orderId,
          buyerMaskedId: user.masked_id,
          buyerPhone: senderPhone,
          reason: cancelMatch[2] || "Buyer cancellation request",
        });
        await approveRefundByAdmin({
          orderId,
          actorPhone: "SYSTEM_AUTO_CANCEL",
        });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Cancellation received. Auto-refund processed via B2C.",
        });
      }
    }

    if (
      (user.user_type === "TRANSPORTER_BIKE" ||
        user.user_type === "TRANSPORTER_TRUCK") &&
      corridorPattern.test(rawMessage)
    ) {
      const corridor = String(rawMessage.match(corridorPattern)?.[1] || "")
        .trim()
        .slice(0, 80);
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
      vehiclePattern.test(rawMessage)
    ) {
      const choice = String(rawMessage.match(vehiclePattern)?.[1] || "").trim();
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
      packedPattern.test(rawMessage.trim())
    ) {
      const match = rawMessage.match(packedPattern);
      const orderId = normalizeOrderIdFromText(match?.[1]);
      const updated = await query(
        `
          UPDATE orders
          SET order_progress_status = 'PACKED',
              updated_at = NOW()
          WHERE id = $1
            AND transporter_masked_id = $2
          RETURNING id
        `,
        [orderId, user.masked_id]
      );
      if (updated.rowCount === 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Order not found/assigned for PACKED update.",
        });
      }
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Order #${orderId.slice(0, 8)} marked PACKED.`,
      });
    }

    if (
      (user.user_type === "TRANSPORTER_BIKE" ||
        user.user_type === "TRANSPORTER_TRUCK") &&
      enRoutePattern.test(rawMessage.trim())
    ) {
      const match = rawMessage.match(enRoutePattern);
      const orderId = normalizeOrderIdFromText(match?.[1]);
      const updated = await query(
        `
          UPDATE orders
          SET order_progress_status = 'EN_ROUTE',
              updated_at = NOW()
          WHERE id = $1
            AND transporter_masked_id = $2
          RETURNING id
        `,
        [orderId, user.masked_id]
      );
      if (updated.rowCount === 0) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Order not found/assigned for EN_ROUTE update.",
        });
      }
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Order #${orderId.slice(0, 8)} marked EN_ROUTE.`,
      });
    }

    if (
      (user.user_type === "TRANSPORTER_BIKE" ||
        user.user_type === "TRANSPORTER_TRUCK") &&
      jobsPattern.test(rawMessage.trim())
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
      claimPattern.test(rawMessage)
    ) {
      const claimMatch = rawMessage.match(claimPattern);
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
      const navLink = await resolveNavigationLinkForOrder({ orderId: claim.id });
      const navText = navLink
        ? `\nNavigation: ${navLink}`
        : "\nNavigation link unavailable (missing location coordinates).";
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Claimed #${claim.id}. Route: ${claim.pickup_location_label} -> ${claim.delivery_location}.${navText}\nAwait payment + customer escrow code.`,
      });
    }

    if (
      (user.user_type === "TRANSPORTER_BIKE" ||
        user.user_type === "TRANSPORTER_TRUCK") &&
      deliverPattern.test(rawMessage)
    ) {
      const deliverMatch = rawMessage.match(deliverPattern);
      if (!deliverMatch) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: "Use format: Deliver <OrderID> <AGZ-123456>",
        });
      }
      try {
        const normalizedOrderId = normalizeOrderIdFromText(deliverMatch[1]);
        await verifyOtpAndQueueRelease({
          orderId: normalizedOrderId,
          otp: deliverMatch[2].toUpperCase(),
        });
        await query(
          `
            UPDATE orders
            SET order_progress_status = 'DELIVERED',
                updated_at = NOW()
            WHERE id = $1
          `,
          [normalizedOrderId]
        );
      } catch (error) {
        await incrementSenderFailure({ phoneNumber: senderPhone });
        return respondToUser({
          res,
          provider,
          senderPhone,
          message: `Delivery verification failed: ${error.message}`,
        });
      }
      return respondToUser({
        res,
        provider,
        senderPhone,
        message:
          "Escrow code verified. Order moved to AWAITING_RELEASE and sent to admin for final approval.",
      });
    }

    if (
      user.user_type === "BUYER" &&
      /^[a-zA-Z][a-zA-Z0-9\s\-]{2,50}$/i.test(rawMessage.trim())
    ) {
      const plainTerm = rawMessage.trim();
      const rowsResult = await searchCatalogRows({
        searchTerm: plainTerm,
      });
      const rankedRows = rankSearchRowsForBuyer({
        rows: rowsResult.rows,
        buyer: user,
      });
      if (rankedRows.length > 0) {
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
              source: "plain-text-auto-search",
              searchTerm: plainTerm,
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
          message: buildSearchTextList({ searchTerm: plainTerm, rankedRows }),
          interactiveList: buildSearchInteractiveList({ searchTerm: plainTerm, rankedRows }),
        });
      }
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
    const legacyAmount = Number(payload.order.total_amount_kes || 0);
    if (legacyAmount > Number(env.security.maxOrderAmountKes || 0)) {
      return respondToUser({
        res,
        provider,
        senderPhone,
        message: `Amount exceeds allowed limit (KSh ${Number(
          env.security.maxOrderAmountKes || 0
        ).toLocaleString()}).`,
      });
    }
    if (Number(env.security.maxDailyAmountKesPerBuyer || 0) > 0) {
      const dailyLegacy = await query(
        `
          SELECT COALESCE(SUM(total_amount_kes), 0) AS total_kes
          FROM orders
          WHERE created_at >= NOW() - INTERVAL '24 hours'
            AND buyer_phone = $1
            AND payment_status IN ('PENDING_PAYMENT', 'PAID_HELD', 'REFUND_REQUESTED', 'REFUNDED')
        `,
        [senderPhone]
      );
      const legacyTotal = Number(dailyLegacy.rows?.[0]?.total_kes || 0);
      if (legacyTotal + legacyAmount > Number(env.security.maxDailyAmountKesPerBuyer || 0)) {
        return respondToUser({
          res,
          provider,
          senderPhone,
          message:
            "Daily payment limit reached for this phone number. Contact admin if this is urgent.",
        });
      }
    }
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
