# AgizaHub AI (Kenya Marketplace MVP)

Backend MVP for a WhatsApp-first broker workflow:

- Receive WhatsApp messages via gateway webhook (WAHA or Twilio)
- Run zero-friction onboarding with masked 5-digit IDs and no contact leakage
- Let merchants classify catalogs as `WHOLESALE`, `RETAILER`, `RESTAURANT`, or `GENERAL_SERVICES`
- Parse conversational Sheng/Swahili/English orders with OpenAI
- Store orders in Supabase Postgres
- Trigger M-Pesa STK push (Daraja sandbox)
- Apply monetization rules:
  - Tiered platform commission on checkout value:
    - `< KSh 20,000 => 2%`
    - `>= KSh 20,000 => 5%`
  - Logistics transporter cut: `10%` of transporter quote
  - Incoming gateway fee: `0.55%` (capped at `KSh 200`, free below `KSh 200`)
  - Outgoing payout fee: flat `KSh 50` per disbursement leg
- Subscription fee removed (commission-only model)
- Transport-only marketplace monetization:
  - requester-side commission follows the same tiered rule (`2%` below 20,000; `5%` at/above 20,000)
  - transporter-side logistics cut uses `LOGISTICS_PREMIUM_PERCENT` (default `10%`)
- Hold escrow and release payouts through dynamic routing:
  - `PHONE -> B2C`
  - `PAYBILL -> B2B BusinessPayBill`
  - `TILL -> B2B BusinessBuyGoods`
- Apply dynamic disbursement-fee deduction on each payout leg before release
- Gate every delivery payout behind explicit admin release/hold action
- Use escrow delivery confirmation token format `AGZ-XXXXXX` (hashed at rest)
- Block supplier catalog activation until merchant confirms terms with `I AGREE`
- Support refund request -> admin approve/reject pipeline
- Reconcile callbacks and run treasury/reconciliation jobs

---

## 0) Critical security step (before any launch)

If secrets were ever shared in chat or screenshots:

1. Revoke old keys immediately
2. Create new provider keys
3. Store only in local `.env` and Render environment variables
4. Never commit `.env`

---

## 1) Local setup

```bash
cd agizahub
cp .env.example .env
# fill .env with rotated keys
npm install
```

If routing AI via OpenRouter, set:

- `BASE_URL=https://openrouter.ai/api/v1`
- `OPENAI_API_KEY=<your_openrouter_key>`

Run migrations:

```bash
npm run migrate
```

Start API:

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:10000/health
```

---

## 2) Supabase (free tier)

1. Create a Supabase project
2. Copy `DATABASE_URL` from project settings
3. Paste into `.env`
4. Run:

```bash
npm run migrate
```

Expected outcome:

- tables exist for `orders`, `vendors`, `transporters`, `mpesa_*`, `treasury_*`
- sample vendors and inventory seeded

---

## 3) WhatsApp gateway setup (WAHA live or Twilio sandbox)

### Option A: WAHA (live line via QR Link Device)

1. Deploy WAHA (Render/Railway/docker)
2. Open WAHA dashboard and link your dedicated WhatsApp line via QR
3. Set WAHA outbound/inbound webhook to:
   - `https://<render-domain>/webhooks/whatsapp/inbound`
4. In app env set:
   - `WHATSAPP_GATEWAY_PROVIDER=WAHA`
   - `WHATSAPP_GATEWAY_API_KEY=<your_waha_key>`
   - `WAHA_BASE_URL`, `WAHA_SESSION_NAME`, `WAHA_SEND_PATH`
   - `WAHA_BOT_PHONE` (your linked Safaricom bot line)
   - `ADMIN_WHATSAPP_PHONE` (authorized admin command line)

Direct WhatsApp link for ads/landing pages:

- format: `https://wa.me/<countrycode+number-without-plus>`
- example for this bot line: `https://wa.me/254745127387`

### Option B: Twilio Sandbox (testing)

1. Open Twilio Console -> Messaging -> Try it out -> WhatsApp Sandbox
2. Set sandbox inbound webhook:
   - Local: `https://<ngrok>.ngrok-free.app/webhooks/whatsapp/inbound`
   - Deployed: `https://<render-domain>/webhooks/whatsapp/inbound`
3. Join sandbox from your WhatsApp using provided `join <code>`
4. Send onboarding flow examples:
   - `1` (buyer registration)
   - `2` (supplier registration)
   - `buy` (buyer sees masked catalog offers)
   - `Buy 89421 10` (buyer places masked-ID order)

Expected outcome:

- API receives inbound message and replies through configured gateway
- STK Push request is initiated for payment-confirmed flows

---

## 4) Daraja sandbox

Set callback URLs to your API domain:

- `/webhooks/mpesa/stk-callback`
- `/webhooks/mpesa/b2c/result`
- `/webhooks/mpesa/b2c/timeout`
- `/webhooks/mpesa/b2b/result`
- `/webhooks/mpesa/b2b/timeout`

Escrow release credentials (required):

- `DARAJA_INITIATOR_NAME` (sandbox commonly `TestInitiator`)
- `DARAJA_INITIATOR_PASSWORD` (the API user's credential/security credential)
- Fee knobs:
  - `COMMISSION_TIER_THRESHOLD_KES=20000`
  - `LOW_VALUE_COMMISSION_PERCENT=2`
  - `HIGH_VALUE_COMMISSION_PERCENT=5`
  - `INCOMING_GATEWAY_FEE_PERCENT=0.55`
  - `INCOMING_GATEWAY_FEE_CAP_KES=200`
  - `INCOMING_GATEWAY_FEE_FREE_BELOW_KES=200`
  - `OUTGOING_PAYOUT_FLAT_FEE_KES=50`

Expected state transitions:

- `PENDING_PAYMENT -> PAID_HELD` (on successful STK callback)
- driver OTP confirmation moves order to `AWAITING_RELEASE`
- admin `Release <OrderID>` command triggers payouts
- payout callbacks update legs and order `distribution_status`

---

## 5) OTP + admin-gated settlement flow

When rider delivers, confirm OTP:

```bash
curl -X POST "http://localhost:10000/orders/<order-id>/confirm-otp" \
  -H "Content-Type: application/json" \
  -d '{"otp":"AGZ-408129"}'
```

On success:

- payout legs are prepared and order is locked in `AWAITING_RELEASE`
- admin must explicitly release funds (`Release <OrderID>`)
- routing executes via B2C/B2B based on wallet/payment mode
- each payout leg is fee-adjusted (`net payout = gross - Daraja disbursement fee`) to protect wallet float
- callbacks reconcile each leg to `SUCCESS/FAILED/TIMEOUT`
- escrow code format is `AGZ-XXXXXX` and is bcrypt-hashed before storage
- share the code only after delivery inspection; transporter submits with `Deliver <OrderID> <AGZ-XXXXXX>`
- outgoing payout fee defaults to `OUTGOING_PAYOUT_FLAT_FEE_KES=50`
- optional advanced tier overrides (if you disable flat fee):
  - `DARAJA_B2C_FEE_RULES_JSON`
  - `DARAJA_B2B_FEE_RULES_JSON`

Transport charge engine for buyer checkout:

- Buyer pays transport
- Formula:
  - Base fee `TRANSPORT_BASE_FEE_KES` for first `TRANSPORT_BASE_DISTANCE_KM`
  - Extra fee `TRANSPORT_PER_KM_FEE_KES` for each additional KM
  - Platform logistics premium `%` on top of raw transport fee
- Distance provider:
  - Primary: Google Distance Matrix API (driving distance)
  - Fallback: internal Haversine calculation when Google API is not configured/unavailable
  - Cached: repeat routes reuse DB cache (`route_distance_cache`) to reduce API cost/latency
  - Native location pins: onboarding + transport flows now accept WhatsApp shared locations directly
  - Navigation links: when a transporter claims a job, bot returns a Google Maps driving route link if coordinates exist

Transport-only mode (no supplier involved):

- Start with `transport` / `move` / `hama` / `safirisha`
- Categories:
  - `COMMERCIAL_FREIGHT` (bulk/business stock movement)
  - `PERSONAL_RELOCATION` (household and personal goods)
- Requester confirms with `1` after quote summary + STK prompt
- Drivers can view open jobs via `jobs` / `kazi` and claim via `Claim <OrderID>` / `chukua <OrderID>`
- Driver targeting is queued in `transport_job_broadcasts` using vehicle class + corridor matching
- Drivers can set targeting profile:
  - `vehicle 1|2|3` or `gari 1|2|3` to set capacity class
  - `corridor <town/area>` or `eneo <town/area>` to set preferred corridor (or leave blank for broad matching)
- Driver finalizes delivery with `Deliver <OrderID> <AGZ-XXXXXX>` or `Wasilisha <OrderID> <AGZ-XXXXXX>`
- Admin still controls release with `Release <OrderID>`
- Global transporter timeout guard:
  - `TRANSPORTER_ASSIGNMENT_TIMEOUT_MINUTES` (default 20)
  - if no delivery confirmation in the window, order auto-rematches to a new eligible transporter
  - applies across order categories that have assigned marketplace transporters
  - each timeout rematch/unassign emits an admin alert template into `admin_notifications_outbox`

Supplier catalog intake:

- supplier onboarding now includes business type choice:
  - `WHOLESALE`, `RETAILER`, `RESTAURANT`, `GENERAL_SERVICES`
- supplier must accept merchant agreement by replying `I AGREE` or `Nakubali` before catalog activation
- for each new buyer order, supplier is immediately notified and must choose logistics mode:
  - supplier first confirms stock (`1` in stock, `2` out of stock) before any buyer payment
  - `1` own transport (no driver broadcast, no logistics premium cut)
  - `2` AgizaHub matching (bot asks vehicle `1/2/3/4` then broadcasts only after selection)
- if seller reports out-of-stock, buyer receives alternative sellers ranked by location then price
- buyer can search marketplace with `search <item>` / `tafuta <item>` and select seller row IDs (`search_select_<catalog>_<seller>`)
- support/help center:
  - `help`, `/help`, `msaada`, or `nisaidie` opens numbered support menu (wrong order, missing code, transporter delay, refund, human admin)
  - option 1 auto-freezes escrow to `DISPUTED_HOLD` and alerts admin
  - option 2 auto-regenerates `AGZ-XXXXXX` token for active paid escrow orders
  - option 4 starts refund flow for eligible unpaid-delivery disputes, else escalates to admin
  - option 5 escalates and freezes bot thread for human review (`AWAITING_ADMIN_INTERVENTION`)
- catalog submission supports:
  - quick line: `Item Name, 1200`
  - multi-line menu/list text (AI parser converts to structured entries)
  - omnichannel ingestion command: `update stock`, `update catalog`, `update my items`, or `add catalogue`
  - ingestion menu options:
    - `1` Type Out Text
    - `2` Upload Document (`.xlsx`, `.xls`, `.csv`, `.docx`, `.doc`, `.pdf`)
    - `3` Snap a Photo (image OCR+AI extraction)
    - `4` Quick Inventory Top-Up
  - media-only uploads are supported in WAHA/Twilio webhook parsing (`__media_shared__` path)
  - document/image ingestion performs deduplicating upsert (existing item names are updated, new ones inserted)
  - seller inventory commands:
    - `Add stock 50 Sugar` or `Ongeza stock 50 Sugar`
    - `Add new item: Premium Milk 1L, Price 150, Stock 20`
    - `my prices` / `bei zangu` (lists seller item IDs + current prices)
    - `/update price <catalog_item_id> <new_price>` or `badili bei <catalog_item_id> <new_price>` (example: `/update price 2 340`)
  - dynamic pricing behavior:
    - sellers can update prices anytime by WhatsApp command (Option B)
    - buyer checkout/STK amount is computed from current DB value at order creation time
    - new orders immediately use the latest saved price

AI prompts added in code:

- `src/services/aiParserService.js`
  - `ESCROW_ENGINE_SYSTEM_PROMPT`
  - `MERCHANT_CATALOG_SYSTEM_PROMPT`
  - `MERCHANT_AGREEMENT_COMPLIANCE_PROMPT`
  - `ORDER_ROUTING_LOGISTICS_PROMPT`
  - `SEARCH_AGGREGATOR_PROMPT`
  - `AVAILABILITY_ESCROW_GATEKEEPER_PROMPT`
  - `SELLER_INVENTORY_UPDATE_PROMPT`
  - `OMNICHANNEL_INGESTION_SYSTEM_PROMPT`
  - `DISPUTE_ARBITRATOR_PROMPT`

---

## 6) Deploy to Render (free tier)

1. Push this repo to GitHub
2. Create a Render web service from repo
3. Root directory: `agizahub`
4. Build command: `npm install`
5. Start command: `npm start`
6. Add all `.env` keys in Render Dashboard
7. Update WhatsApp gateway + Daraja webhooks to Render URL

Recommended core Render vars (minimum):

- `OPENAI_BASE_URL=https://openrouter.ai/api/v1`
- `OPENAI_API_KEY=<your_openrouter_key>`
- `OPENAI_MODEL=gpt-4o-mini`
- `GOOGLE_MAPS_API_KEY=<your_google_maps_key>`
- `DATABASE_URL=<postgres_connection_string>`

Expected outcome:

- full webhook flow works without ngrok
- free tier may sleep after inactivity

---

## 7) Free alternatives

- WhatsApp provider:
  - WAHA (live QR-linked line, no Meta document gate)
  - Twilio Sandbox (easy/faster start)
  - Africa's Talking (local-market friendly, can switch later)
- Hosting:
  - Render free web service (recommended MVP start)
  - Railway/Fly (if free Render limits are restrictive)

---

## 8) API endpoints

- `GET /health`
- `POST /webhooks/whatsapp/inbound`
- `POST /webhooks/mpesa/stk-callback`
- `POST /webhooks/mpesa/b2c/result`
- `POST /webhooks/mpesa/b2c/timeout`
- `POST /webhooks/mpesa/b2b/result`
- `POST /webhooks/mpesa/b2b/timeout`
- `POST /orders/:orderId/confirm-otp`
- `POST /orders/:orderId/release`
- `POST /orders/:orderId/hold`
- `POST /orders/:orderId/refund-request`
- `POST /orders/:orderId/refund/approve`
- `POST /orders/:orderId/refund/reject`

---

## 9) Production hardening checklist

- Idempotency keys for all callbacks
- OTP mandatory for settlement
- No final success until all payout legs succeed
- Alerts for payout failure, callback mismatch, low float
- Daily reconciliation job active
- Encrypt sensitive data at rest
- Principle of least privilege for DB/API credentials
- Webhook security:
  - WAHA inbound key auth (`WAHA_WEBHOOK_SECRET` or gateway API key fallback)
  - Daraja callback source-IP whitelist (`DARAJA_ENFORCE_IP_WHITELIST=true`, `DARAJA_ALLOWED_IPS=196.201.214.200,196.201.214.206,...`)
  - inbound webhook request logging to `webhook_request_logs`
- API perimeter:
  - HTTPS-only enforcement in production (`BLOCK_NON_HTTPS_REQUESTS=true`)
  - CORS allowlist support (`CORS_ALLOWED_ORIGINS=https://yourapp.com,https://admin.yourapp.com`)
- Abuse prevention:
  - sender activity telemetry persisted in `sender_abuse_controls` (no automatic mute/ban)
- Admin security:
  - admin phone whitelist (`ADMIN_WHATSAPP_PHONE` / `ADMIN_WHATSAPP_PHONES`)
  - token-based privileged session (`ADMIN_REQUIRE_TOKEN=true`)
  - commands:
    - `admin token` (issue 4-digit code)
    - `verify <code>` (start privileged session)
    - `logout` (end session)
    - `broadcast buyers <message>` (promo blast)
- Registration security:
  - phone-owner OTP gate on first contact (4-digit verification before onboarding)
- Payment integrity:
  - callback amount mismatch detection (expected STK amount vs callback amount)
  - duplicate `MpesaReceiptNumber` replay blocking
  - max per-order and rolling daily buyer cap (`MAX_ORDER_AMOUNT_KES`, `MAX_DAILY_AMOUNT_KES_PER_BUYER`)

---

## 10) Marketplace command quickstart

- Buyer:
  - `categories` -> browse numbered departments
  - `category <number|name>` -> list products by department
  - `search <item>` / `compare <item>` / `detail <catalog_item_id>`
  - `wishlist add <catalog_item_id>`, `wishlist`, `wishlist remove <catalog_item_id>`
  - `cart add <catalog_item_id> <qty>`, `cart`, `checkout`, `cart clear`
  - `reorder` (repeat last order)
  - `status [order_id]`, `rate <order_id> <1-5> [comment]`
  - `my referral`, `refer <code>`, `points`
- Supplier:
  - `/update price <item_id> <new_price>`, `my prices`
  - `delete item <item_id>`
  - `lowstock <item_id> <threshold>`
  - `payout request <amount>`
- Transporter:
  - `jobs`, `claim <order_id>`
  - `packed <order_id>`, `enroute <order_id>`
  - `deliver <order_id> <AGZ-XXXXXX>`
- Admin:
  - `release <order_id>`, `hold <order_id>`, `approve <order_id>`, `reject <order_id>`
  - `payout approve <request_id>`
  - `broadcast buyers <message>`
