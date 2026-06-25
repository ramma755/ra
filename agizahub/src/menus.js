const MENUS = {
  ROLE_SELECT: () =>
    [
      "👋 Jambo! Welcome to AgizaHub.",
      "",
      "Please choose your role:",
      "",
      "1️⃣  Buyer — browse & order products",
      "2️⃣  Seller / Supplier — list & sell your products",
      "3️⃣  Transporter (Bike) — short distance deliveries",
      "4️⃣  Transporter (Truck) — long distance deliveries",
      "",
      "Reply with 1, 2, 3 or 4.",
    ].join("\n"),

  WELCOME_ROLE_SELECT: (name = "") =>
    [
      `✅ Phone verification successful. Karibu AgizaHub${name ? `, ${name}` : ""}!`,
      "",
      "Please choose your role:",
      "",
      "1️⃣  Buyer — browse & order products",
      "2️⃣  Seller / Supplier — list & sell your products",
      "3️⃣  Transporter (Bike) — short distance deliveries",
      "4️⃣  Transporter (Truck) — long distance deliveries",
      "",
      "Reply with 1, 2, 3 or 4.",
    ].join("\n"),

  PAYMENT_MODE: () =>
    [
      "💳 Payment & payout setup",
      "",
      "Choose how AgizaHub should process payments/refunds:",
      "",
      "1️⃣  Send Money (M-Pesa to your phone)",
      "2️⃣  Buy Goods Till Number",
      "3️⃣  Business Paybill",
      "",
      "Reply with 1, 2 or 3.",
    ].join("\n"),

  SUPPLIER_BUSINESS_TYPE: () =>
    [
      "🏪 Seller catalog type",
      "",
      "1️⃣  WHOLESALE",
      "2️⃣  RETAILER",
      "3️⃣  RESTAURANT",
      "4️⃣  GENERAL_SERVICES",
      "",
      "Reply with 1, 2, 3 or 4.",
    ].join("\n"),

  SELLER_LOGISTICS: () =>
    [
      "🚚 Logistics selection",
      "",
      "How will this order be delivered?",
      "",
      "1️⃣  I will use my own delivery transport",
      "2️⃣  Match me with an AgizaHub transporter",
      "",
      "Reply with 1 or 2.",
    ].join("\n"),

  SELLER_VEHICLE_SELECTION: () =>
    [
      "🛻 Vehicle selection",
      "",
      "Select a delivery vehicle type:",
      "",
      "1️⃣  Rider / Motorbike (small packages)",
      "2️⃣  TukTuk (medium store supplies)",
      "3️⃣  Pickup Truck (bulk goods up to 1 ton)",
      "4️⃣  Lorry / Truck (heavy commercial distribution)",
      "",
      "Reply with 1, 2, 3 or 4.",
    ].join("\n"),

  SELLER_STOCK_CONFIRMATION: (orderId) =>
    [
      `📦 Order #${String(orderId || "").slice(0, 8)} stock confirmation`,
      "",
      "1️⃣  In stock",
      "2️⃣  Out of stock",
      "",
      "Reply with 1 or 2.",
    ].join("\n"),

  BUYER_DEPOSIT_DECISION: ({ orderId, totalAmountKes }) =>
    [
      "🧾 Payment authorization",
      `Order #${String(orderId || "").slice(0, 8)} has been confirmed by seller.`,
      `Total due: KSh ${Number(totalAmountKes || 0).toLocaleString()}`,
      "",
      "1️⃣  Deposit now (trigger M-Pesa STK prompt)",
      "2️⃣  Cancel order",
      "",
      "Reply with 1 or 2.",
    ].join("\n"),

  TRANSPORT_CATEGORY: () =>
    [
      "📦 Transport request category",
      "",
      "1️⃣  Commercial Freight (business stock / wholesale goods)",
      "2️⃣  Personal Relocation (house move / personal items)",
      "",
      "Reply with 1 or 2.",
    ].join("\n"),

  TRANSPORT_VEHICLE: () =>
    [
      "🚛 Transport vehicle size",
      "",
      "1️⃣  Motorbike (small packages)",
      "2️⃣  Tuk-tuk / Pickup (small move / <=1 tonne)",
      "3️⃣  Canter / Truck (bulk load / 3+ tonnes)",
      "",
      "Reply with 1, 2 or 3.",
    ].join("\n"),

  CATALOG_INGESTION: () =>
    [
      "📚 AgizaHub Inventory Engine",
      "",
      "Choose how you want to update your catalog:",
      "",
      "1️⃣  Type text (Product, Price, Category)",
      "2️⃣  Upload document (Excel/Word/PDF/CSV)",
      "3️⃣  Upload photo (menu board / list)",
      "4️⃣  Quick top-up (Add stock / Update price)",
      "5️⃣  Guided wizard (Name -> Unit -> Price -> Stock)",
      "",
      "Reply with 1, 2, 3, 4 or 5.",
    ].join("\n"),

  HELP_CENTER: () =>
    [
      "🆘 AgizaHub Help Center",
      "",
      "How can we help you?",
      "",
      "1️⃣  Wrong order delivered",
      "2️⃣  No delivery code sent",
      "3️⃣  Transporter delay",
      "4️⃣  Payment / refund request",
      "5️⃣  Talk to human admin",
      "",
      "Reply with 1, 2, 3, 4 or 5.",
    ].join("\n"),

  PROFILE_NAME_PROMPT: () =>
    [
      "🪪 Profile name setup",
      "",
      "Reply with your personal name or company/business name.",
      "Example: Peter Mwangi OR Muiruri Traders Ltd",
    ].join("\n"),

  ADMIN_MENU: () =>
    [
      "👑 AgizaHub Admin Panel",
      "",
      "1️⃣  Platform stats + revenue (today)",
      "2️⃣  Pending orders (latest 10)",
      "3️⃣  Recent users (latest 15)",
      "4️⃣  Release order (then send ORDER-ID)",
      "5️⃣  Force refund order (then send ORDER-ID)",
      "6️⃣  Close order (then send ORDER-ID)",
      "7️⃣  Revenue dashboard (today)",
      "8️⃣  Broadcast buyers (then send message text)",
      "9️⃣  Broadcast all users (then send message text)",
      "🔟  Logout admin session",
      "",
      "Also supported: hold/approve/reject/payout approve/set tier/unban/broadcast sellers.",
      "Reply with a number (guided flow) or type command directly. Type 0 for this menu.",
    ].join("\n"),
};

module.exports = MENUS;
