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
const {
  confirmDeliveryOtp,
  releaseOrder,
  holdOrder,
  requestRefund,
  approveRefund,
  rejectRefund,
} = require("../controllers/ordersController");
const {
  logInboundWebhook,
  requireWahaWebhookAuth,
  requireDarajaCallbackIp,
} = require("../middleware/securityMiddleware");

const router = express.Router();

router.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "agizahub-api" });
});

router.post(
  "/webhooks/whatsapp/inbound",
  logInboundWebhook({ source: "WHATSAPP" }),
  requireWahaWebhookAuth,
  handleIncomingWhatsapp
);
router.post(
  "/webhooks/mpesa/stk-callback",
  logInboundWebhook({ source: "DARAJA_STK" }),
  requireDarajaCallbackIp,
  handleStkCallback
);
router.post(
  "/webhooks/mpesa/b2c/result",
  logInboundWebhook({ source: "DARAJA_B2C_RESULT" }),
  requireDarajaCallbackIp,
  handleB2cResultCallback
);
router.post(
  "/webhooks/mpesa/b2c/timeout",
  logInboundWebhook({ source: "DARAJA_B2C_TIMEOUT" }),
  requireDarajaCallbackIp,
  handleB2cTimeoutCallback
);
router.post(
  "/webhooks/mpesa/b2b/result",
  logInboundWebhook({ source: "DARAJA_B2B_RESULT" }),
  requireDarajaCallbackIp,
  handleB2bResultCallback
);
router.post(
  "/webhooks/mpesa/b2b/timeout",
  logInboundWebhook({ source: "DARAJA_B2B_TIMEOUT" }),
  requireDarajaCallbackIp,
  handleB2bTimeoutCallback
);

router.post("/orders/:orderId/confirm-otp", confirmDeliveryOtp);
router.post("/orders/:orderId/release", releaseOrder);
router.post("/orders/:orderId/hold", holdOrder);
router.post("/orders/:orderId/refund-request", requestRefund);
router.post("/orders/:orderId/refund/approve", approveRefund);
router.post("/orders/:orderId/refund/reject", rejectRefund);

module.exports = router;
