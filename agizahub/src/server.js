const app = require("./app");
const env = require("./config/env");
const { pool } = require("./config/db");
const { startSchedulers } = require("./jobs/scheduler");
const logger = require("./services/logger");

const boot = async () => {
  try {
    await pool.query("SELECT 1");
    app.listen(env.port, () => {
      logger.info(`AgizaHub API listening on port ${env.port}`);
    });
    startSchedulers();
  } catch (error) {
    logger.error("Failed to boot server", { error: error.message });
    process.exit(1);
  }
};

boot();
