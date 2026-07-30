const express = require("express");

const router = express.Router();

const disabled = (_req, res) => {
  res.status(410).json({
    ok: false,
    service: "agizahub-api",
    status: "DISABLED",
    message: "Bot service is disabled and all automations are reset.",
  });
};

router.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "agizahub-api",
    status: "DISABLED",
    branch: process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || null,
    commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null,
  });
});

router.post("/webhooks/whatsapp/inbound", disabled);
router.post("/webhooks/mpesa/stk-callback", disabled);
router.post("/webhooks/mpesa/b2c/result", disabled);
router.post("/webhooks/mpesa/b2c/timeout", disabled);
router.post("/webhooks/mpesa/b2b/result", disabled);
router.post("/webhooks/mpesa/b2b/timeout", disabled);
router.post("/orders/:orderId/confirm-otp", disabled);
router.post("/orders/:orderId/release", disabled);
router.post("/orders/:orderId/hold", disabled);
router.post("/orders/:orderId/refund-request", disabled);
router.post("/orders/:orderId/refund/approve", disabled);
router.post("/orders/:orderId/refund/reject", disabled);

module.exports = router;
