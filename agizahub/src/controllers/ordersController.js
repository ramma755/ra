const { verifyOtpAndStartSettlement } = require("../services/settlementService");

const confirmDeliveryOtp = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { otp } = req.body;
    if (!otp) {
      return res.status(400).json({ error: "otp is required" });
    }

    const result = await verifyOtpAndStartSettlement({ orderId, otp });
    return res.status(200).json({
      message: "OTP verified and settlement started",
      result,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  confirmDeliveryOtp,
};
