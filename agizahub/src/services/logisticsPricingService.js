const env = require("../config/env");

const toRadians = (degrees) => (Number(degrees) * Math.PI) / 180;

const haversineDistanceKm = ({ fromLat, fromLng, toLat, toLng }) => {
  const lat1 = Number(fromLat);
  const lon1 = Number(fromLng);
  const lat2 = Number(toLat);
  const lon2 = Number(toLng);

  if ([lat1, lon1, lat2, lon2].some((value) => Number.isNaN(value))) {
    return null;
  }

  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((earthRadiusKm * c).toFixed(2));
};

const computeTransportBreakdown = ({ distanceKm }) => {
  const safeDistance = Math.max(0, Number(distanceKm || 0));
  const baseFee = Number(env.businessRules.transportBaseFeeKes);
  const baseDistance = Number(env.businessRules.transportBaseDistanceKm);
  const perKmFee = Number(env.businessRules.transportPerKmFeeKes);
  const logisticsPremiumPercent = Number(env.businessRules.logisticsPremiumPercent);

  const extraDistanceKm = Math.max(0, safeDistance - baseDistance);
  const extraDistanceFeeKes = Number((extraDistanceKm * perKmFee).toFixed(2));
  const rawTransportFeeKes = Number((baseFee + extraDistanceFeeKes).toFixed(2));
  const logisticsPremiumKes = Number(
    ((rawTransportFeeKes * logisticsPremiumPercent) / 100).toFixed(2)
  );
  const totalTransportFeeKes = Number(
    (rawTransportFeeKes + logisticsPremiumKes).toFixed(2)
  );

  return {
    distanceKm: safeDistance,
    baseDistanceKm: baseDistance,
    baseFeeKes: baseFee,
    perKmFeeKes: perKmFee,
    extraDistanceKm: Number(extraDistanceKm.toFixed(2)),
    extraDistanceFeeKes,
    rawTransportFeeKes,
    logisticsPremiumPercent,
    logisticsPremiumKes,
    totalTransportFeeKes,
  };
};

module.exports = {
  haversineDistanceKm,
  computeTransportBreakdown,
};
