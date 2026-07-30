const app = require("./app");
const env = require("./config/env");
const logger = require("./services/logger");

const boot = async () => {
  app.listen(env.port, () => {
    logger.info(`AgizaHub API listening on port ${env.port} in DISABLED mode`);
  });
};

boot();
