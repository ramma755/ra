const env = require("../config/env");

const asNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const resolveTierFee = (amountKes, rules) => {
  const amount = asNumber(amountKes);
  const matched = (rules || []).find(
    (rule) => amount >= asNumber(rule.min) && amount <= asNumber(rule.max)
  );
  if (!matched) return 0;
  return Number(asNumber(matched.fee).toFixed(2));
};

const resolveDisbursementFeeKes = ({ amountKes, destinationType }) => {
  const amount = asNumber(amountKes);
  if (amount <= 0) return 0;
  const channel = destinationType === "PHONE" ? "B2C" : "B2B";
  const rules = channel === "B2C" ? env.daraja.b2cFeeRules : env.daraja.b2bFeeRules;
  return resolveTierFee(amount, rules);
};

module.exports = {
  resolveDisbursementFeeKes,
};
