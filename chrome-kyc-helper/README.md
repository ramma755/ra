# Handshake KYC Test Helper (Chrome Extension)

This extension adds a one-click **Instant Verify (Test)** button on:

- `https://ai.joinhandshake.com/fellow/onboarding`

It calls your local bot (`python-kyc-bot`) directly, so you do not need ngrok.

## What it does

1. Calls `POST /profiles/upsert`
2. Calls `POST /identity/persona/start` with `skip_uploads: true`
3. If needed, falls back to `POST /identity/persona/auto-complete-success`
4. Redirects to dashboard when verification is approved

## 1) Start the local bot first

From `python-kyc-bot`:

```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
```

## 2) Load extension in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `chrome-kyc-helper`

## 3) Use it on onboarding page

1. Open `https://ai.joinhandshake.com/fellow/onboarding`
2. Click **Instant Verify (Test)** (floating button)
3. Confirm/edit:
   - Bot URL: `http://127.0.0.1:8080`
   - Reference ID: `eb9b89bd-dac9-4345-aed3-9da525e52a38`
   - Name: `Crystal Little`
   - DOB: `1980-04-18`
4. Click **Approve now**

If approved, it redirects to `https://ai.joinhandshake.com/fellow/dashboard` by default.

## Notes

- Keep your local bot terminal running while using the extension.
- You can change the values in the modal; they are saved locally in Chrome extension storage.
