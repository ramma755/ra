const logger = require("./logger");

const submitBankSweep = async ({ amountKes, reference }) => {
  logger.info("Treasury provider adapter invoked", { amountKes, reference });

  // Integrate your bank API or PSP treasury endpoint here.
  // Returning a deterministic stub keeps the workflow testable in sandbox.
  return {
    providerReference: `stub-sweep-${Date.now()}`,
    status: "SUBMITTED",
  };
};

module.exports = {
  submitBankSweep,
};
