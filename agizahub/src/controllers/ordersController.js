const {
  verifyOtpAndQueueRelease,
  releaseOrderByAdmin,
  holdOrderByAdmin,
  requestOrderRefund,
  approveRefundByAdmin,
  rejectRefundByAdmin,
} = require("../services/settlementService");

const confirmDeliveryOtp = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { otp } = req.body;
    if (!otp) {
      return res.status(400).json({ error: "otp is required" });
    }

    const result = await verifyOtpAndQueueRelease({ orderId, otp });
    return res.status(200).json({
      message: "OTP verified. Order now awaits admin release authorization.",
      result,
    });
  } catch (error) {
    return next(error);
  }
};

const releaseOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const actorPhone = req.body.actorPhone || "api-admin";
    const result = await releaseOrderByAdmin({ orderId, actorPhone });
    return res.status(200).json({
      message: "Order release approved and payouts submitted.",
      result,
    });
  } catch (error) {
    return next(error);
  }
};

const holdOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const actorPhone = req.body.actorPhone || "api-admin";
    const note = req.body.note || null;
    const result = await holdOrderByAdmin({ orderId, actorPhone, note });
    return res.status(200).json({
      message: "Order placed on hold for manual review.",
      result,
    });
  } catch (error) {
    return next(error);
  }
};

const requestRefund = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { buyerMaskedId, buyerPhone, reason } = req.body;
    if (!buyerMaskedId && !buyerPhone) {
      return res.status(400).json({
        error: "buyerMaskedId or buyerPhone is required",
      });
    }

    const result = await requestOrderRefund({
      orderId,
      buyerMaskedId,
      buyerPhone,
      reason,
    });
    return res.status(200).json({
      message: "Refund request submitted for admin decision.",
      result,
    });
  } catch (error) {
    return next(error);
  }
};

const approveRefund = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const actorPhone = req.body.actorPhone || "api-admin";
    const result = await approveRefundByAdmin({ orderId, actorPhone });
    return res.status(200).json({
      message: "Refund approved and payout submitted.",
      result,
    });
  } catch (error) {
    return next(error);
  }
};

const rejectRefund = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const actorPhone = req.body.actorPhone || "api-admin";
    const result = await rejectRefundByAdmin({ orderId, actorPhone });
    return res.status(200).json({
      message: "Refund rejected. Order returned to release queue.",
      result,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  confirmDeliveryOtp,
  releaseOrder,
  holdOrder,
  requestRefund,
  approveRefund,
  rejectRefund,
};
