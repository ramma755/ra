# AgizaHub AI (Kenya Marketplace MVP)

Backend MVP for a WhatsApp-first broker workflow:

- Receive WhatsApp orders (Twilio sandbox webhook)
- Parse conversational Sheng/Swahili/English orders with OpenAI
- Store orders in Supabase Postgres
- Trigger M-Pesa STK push (Daraja sandbox)
- Hold escrow and release payouts through dynamic routing:
  - `PHONE -> B2C`
  - `PAYBILL -> B2B BusinessPayBill`
  - `TILL -> B2B BusinessBuyGoods`
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

## 3) Twilio WhatsApp Sandbox (free testing)

1. Open Twilio Console -> Messaging -> Try it out -> WhatsApp Sandbox
2. Set sandbox inbound webhook:
   - Local: `https://<ngrok>.ngrok-free.app/webhooks/whatsapp/inbound`
   - Deployed: `https://<render-domain>/webhooks/whatsapp/inbound`
3. Join sandbox from your WhatsApp using provided `join <code>`
4. Send message example:
   - `Nipee 20kg nyanya to Westlands`

Expected outcome:

- API creates order
- STK Push request is initiated

---

## 4) Daraja sandbox

Set callback URLs to your API domain:

- `/webhooks/mpesa/stk-callback`
- `/webhooks/mpesa/b2c/result`
- `/webhooks/mpesa/b2c/timeout`
- `/webhooks/mpesa/b2b/result`
- `/webhooks/mpesa/b2b/timeout`

Expected state transitions:

- `PENDING_PAYMENT -> PAID_HELD` (on successful STK callback)
- OTP confirmation endpoint starts settlement payouts
- payout callbacks update legs and order `distribution_status`

---

## 5) OTP-confirmed settlement flow

When rider delivers, confirm OTP:

```bash
curl -X POST "http://localhost:10000/orders/<order-id>/confirm-otp" \
  -H "Content-Type: application/json" \
  -d '{"otp":"123456"}'
```

On success:

- payout legs created (`vendor`, `driver`)
- routing executed via B2C/B2B based on wallet type
- callbacks reconcile each leg to `SUCCESS/FAILED/TIMEOUT`

---

## 6) Deploy to Render (free tier)

1. Push this repo to GitHub
2. Create a Render web service from repo
3. Root directory: `agizahub`
4. Build command: `npm install`
5. Start command: `npm start`
6. Add all `.env` keys in Render Dashboard
7. Update Twilio + Daraja webhooks to Render URL

Expected outcome:

- full webhook flow works without ngrok
- free tier may sleep after inactivity

---

## 7) Free alternatives

- WhatsApp provider:
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

---

## 9) Production hardening checklist

- Idempotency keys for all callbacks
- OTP mandatory for settlement
- No final success until all payout legs succeed
- Alerts for payout failure, callback mismatch, low float
- Daily reconciliation job active
- Encrypt sensitive data at rest
- Principle of least privilege for DB/API credentials
