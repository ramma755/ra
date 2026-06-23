const cron = require("node-cron");
const { runDailyReconciliation } = require("../services/reconciliationService");
const { runAutoSweep } = require("../services/treasuryService");
const {
  runTransporterTimeoutReassignment,
} = require("../services/transporterTimeoutService");
const {
  runDailySellerSalesReports,
} = require("../services/dailySellerReportService");
const logger = require("../services/logger");

const startSchedulers = () => {
  cron.schedule("0 2 * * *", async () => {
    try {
      const result = await runDailyReconciliation();
      logger.info("Daily reconciliation finished", result);
    } catch (error) {
      logger.error("Daily reconciliation failed", { error: error.message });
    }
  });

  cron.schedule("*/20 * * * *", async () => {
    try {
      const result = await runAutoSweep();
      logger.info("Auto sweep run finished", result);
    } catch (error) {
      logger.error("Auto sweep failed", { error: error.message });
    }
  });

  cron.schedule("*/2 * * * *", async () => {
    try {
      const result = await runTransporterTimeoutReassignment();
      logger.info("Transport timeout reassignment run finished", result);
    } catch (error) {
      logger.error("Transport timeout reassignment failed", {
        error: error.message,
      });
    }
  });

  cron.schedule("0 20 * * *", async () => {
    try {
      const result = await runDailySellerSalesReports();
      logger.info("Daily seller sales reports finished", result);
    } catch (error) {
      logger.error("Daily seller sales reports failed", {
        error: error.message,
      });
    }
  });
};

module.exports = {
  startSchedulers,
};
