const express = require("express");
const { handleIncomingWhatsapp } = require("../controllers/whatsappWebhookController");
const { handleStkCallback } = require("../controllers/mpesaStkController");
const {
  handleB2cResultCallback,
  handleB2cTimeoutCallback,
} = require("../controllers/mpesaB2cController");
const {
  handleB2bResultCallback,
  handleB2bTimeoutCallback,
} = require("../controllers/mpesaB2bController");
const { confirmDeliveryOtp } = require("../controllers/ordersController");

const router = express.Router();

router.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "agizahub-api" });
});

router.post("/webhooks/whatsapp/inbound", handleIncomingWhatsapp);
router.post("/webhooks/mpesa/stk-callback", handleStkCallback);
router.post("/webhooks/mpesa/b2c/result", handleB2cResultCallback);
router.post("/webhooks/mpesa/b2c/timeout", handleB2cTimeoutCallback);
router.post("/webhooks/mpesa/b2b/result", handleB2bResultCallback);
router.post("/webhooks/mpesa/b2b/timeout", handleB2bTimeoutCallback);

router.post("/orders/:orderId/confirm-otp", confirmDeliveryOtp);

module.exports = router;
