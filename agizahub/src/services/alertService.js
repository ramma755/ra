const logger = require("./logger");

const sendOpsAlert = async ({ level, message, payload }) => {
  logger.warn("OPS ALERT", { level, message, payload });
};

module.exports = {
  sendOpsAlert,
};
