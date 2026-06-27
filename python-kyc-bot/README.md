# Python KYC Test Bot (Persona Sandbox)

This is a standalone Python service for testing your mobile/web onboarding flow with:

1. Email signup
2. Phone OTP verification
3. Automatic identity verification with Persona sandbox (ID/DL + selfie)
4. Automatic Name + DOB match before dashboard unlock

No admin approval is required. Decisions are automatic.

## 1) Install

```bash
cd python-kyc-bot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Update `.env` with your Persona sandbox keys/template.

## 2) Run

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

## 3) API Flow

### Signup

`POST /auth/signup`

```json
{
  "email": "tester@example.com",
  "password": "StrongPass123!",
  "legal_name": "Jane Wanjiku Doe",
  "date_of_birth": "1997-08-11",
  "phone": "+254712345678"
}
```

### Send OTP

`POST /auth/phone/send-otp`

```json
{ "email": "tester@example.com" }
```

### Verify OTP

`POST /auth/phone/verify-otp`

```json
{
  "email": "tester@example.com",
  "otp_code": "123456"
}
```

### Start Persona inquiry

`POST /identity/persona/start`

```json
{ "email": "tester@example.com" }
```

Response contains the `inquiry_id` and Persona URL. Open that URL in frontend/webview.

### Identity status

`GET /identity/status?email=tester@example.com`

## 4) Persona Webhook

Configure Persona webhook to:

`POST /webhooks/persona`

Use the same `PERSONA_WEBHOOK_SECRET` in Persona dashboard and `.env`.

When Persona marks an inquiry complete/approved, this service:

- fetches the inquiry details,
- extracts verified name and DOB,
- compares against signup data,
- sets status:
  - `APPROVED` -> dashboard unlocked
  - `FAILED` -> mismatch reason recorded

## 5) Name + DOB matching logic

- Name is normalized (case-folded, punctuation stripped, whitespace collapsed).
- Name tokens from signup must be present in verified identity name.
- DOB must match exactly (YYYY-MM-DD).

This keeps testing realistic while fully automatic.
