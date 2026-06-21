const env = require("../config/env");

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveTieredCommissionPercent = (transactionValueKes) => {
  const value = asNumber(transactionValueKes, 0);
  const threshold = asNumber(env.businessRules.commissionTierThresholdKes, 20000);
  const low = asNumber(env.businessRules.lowValueCommissionPercent, 2);
  const high = asNumber(env.businessRules.highValueCommissionPercent, 5);
  return value < threshold ? low : high;
};

const computeIncomingGatewayFeeKes = (amountKes) => {
  const amount = asNumber(amountKes, 0);
  const freeBelow = asNumber(env.businessRules.incomingGatewayFeeFreeBelowKes, 200);
  if (amount < freeBelow) {
    return 0;
  }

  const percent = asNumber(env.businessRules.incomingGatewayFeePercent, 0.55);
  const cap = asNumber(env.businessRules.incomingGatewayFeeCapKes, 200);
  const rawFee = Number(((amount * percent) / 100).toFixed(2));
  return Number(Math.min(rawFee, cap).toFixed(2));
};

module.exports = {
  resolveTieredCommissionPercent,
  computeIncomingGatewayFeeKes,
};
