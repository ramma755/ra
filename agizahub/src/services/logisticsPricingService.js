const axios = require("axios");
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

const googleDistanceKm = async ({ fromLat, fromLng, toLat, toLng }) => {
  if (!env.googleMaps.apiKey) {
    return null;
  }

  const origins = `${Number(fromLat)},${Number(fromLng)}`;
  const destinations = `${Number(toLat)},${Number(toLng)}`;
  const response = await axios.get(env.googleMaps.distanceMatrixUrl, {
    params: {
      origins,
      destinations,
      mode: "driving",
      units: "metric",
      key: env.googleMaps.apiKey,
    },
    timeout: 12000,
  });

  if (response.data?.status !== "OK") {
    throw new Error(`Google distance matrix failed: ${response.data?.status}`);
  }

  const element = response.data?.rows?.[0]?.elements?.[0];
  if (!element || element.status !== "OK") {
    throw new Error(
      `Google distance element unavailable: ${element?.status || "UNKNOWN"}`
    );
  }

  const meters = Number(element.distance?.value || 0);
  if (!meters || Number.isNaN(meters)) {
    throw new Error("Google distance value missing");
  }

  return Number((meters / 1000).toFixed(2));
};

const resolveRouteDistance = async ({ fromLat, fromLng, toLat, toLng }) => {
  try {
    const km = await googleDistanceKm({ fromLat, fromLng, toLat, toLng });
    if (km != null) {
      return {
        distanceKm: km,
        distanceProvider: "google-distance-matrix",
      };
    }
  } catch (_error) {
    // Fallback to local haversine for resilience.
  }

  return {
    distanceKm:
      haversineDistanceKm({
        fromLat,
        fromLng,
        toLat,
        toLng,
      }) || Number(env.businessRules.transportBaseDistanceKm),
    distanceProvider: "haversine-fallback",
  };
};

module.exports = {
  haversineDistanceKm,
  computeTransportBreakdown,
  resolveRouteDistance,
};
