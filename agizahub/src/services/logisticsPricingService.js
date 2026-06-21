const axios = require("axios");
const env = require("../config/env");
const { query } = require("../config/db");

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

const routeKey = ({ fromLat, fromLng, toLat, toLng }) => {
  const dp = Math.max(1, Number(env.googleMaps.routePrecisionDp || 4));
  const normalize = (value) => Number(value).toFixed(dp);
  return `${normalize(fromLat)}:${normalize(fromLng)}->${normalize(toLat)}:${normalize(
    toLng
  )}`;
};

const readDistanceCache = async ({ key }) => {
  try {
    const result = await query(
      `
        SELECT distance_km, provider, updated_at
        FROM route_distance_cache
        WHERE route_key = $1
        LIMIT 1
      `,
      [key]
    );
    if (result.rowCount === 0) return null;

    const row = result.rows[0];
    const ttlMs = Number(env.googleMaps.cacheTtlHours || 168) * 60 * 60 * 1000;
    const ageMs = Date.now() - new Date(row.updated_at).getTime();
    if (ageMs > ttlMs) {
      return null;
    }

    await query(
      `
        UPDATE route_distance_cache
        SET hit_count = hit_count + 1,
            updated_at = NOW()
        WHERE route_key = $1
      `,
      [key]
    );

    return {
      distanceKm: Number(row.distance_km),
      distanceProvider: `cache:${row.provider}`,
    };
  } catch (_error) {
    return null;
  }
};

const writeDistanceCache = async ({
  key,
  fromLat,
  fromLng,
  toLat,
  toLng,
  distanceKm,
  provider,
}) => {
  try {
    await query(
      `
        INSERT INTO route_distance_cache (
          route_key,
          origin_latitude,
          origin_longitude,
          destination_latitude,
          destination_longitude,
          distance_km,
          provider,
          hit_count,
          updated_at,
          last_refreshed_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,0,NOW(),NOW())
        ON CONFLICT (route_key)
        DO UPDATE SET
          origin_latitude = EXCLUDED.origin_latitude,
          origin_longitude = EXCLUDED.origin_longitude,
          destination_latitude = EXCLUDED.destination_latitude,
          destination_longitude = EXCLUDED.destination_longitude,
          distance_km = EXCLUDED.distance_km,
          provider = EXCLUDED.provider,
          updated_at = NOW(),
          last_refreshed_at = NOW()
      `,
      [key, fromLat, fromLng, toLat, toLng, distanceKm, provider]
    );
  } catch (_error) {
    // Cache write failures should not block pricing.
  }
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
  const key = routeKey({ fromLat, fromLng, toLat, toLng });
  const cached = await readDistanceCache({ key });
  if (cached) {
    return cached;
  }

  try {
    const km = await googleDistanceKm({ fromLat, fromLng, toLat, toLng });
    if (km != null) {
      await writeDistanceCache({
        key,
        fromLat,
        fromLng,
        toLat,
        toLng,
        distanceKm: km,
        provider: "google-distance-matrix",
      });
      return {
        distanceKm: km,
        distanceProvider: "google-distance-matrix",
      };
    }
  } catch (_error) {
    // Fallback to local haversine for resilience.
  }

  const haversineKm =
    haversineDistanceKm({
      fromLat,
      fromLng,
      toLat,
      toLng,
    }) || Number(env.businessRules.transportBaseDistanceKm);

  await writeDistanceCache({
    key,
    fromLat,
    fromLng,
    toLat,
    toLng,
    distanceKm: haversineKm,
    provider: "haversine-fallback",
  });

  return {
    distanceKm: haversineKm,
    distanceProvider: "haversine-fallback",
  };
};

module.exports = {
  haversineDistanceKm,
  computeTransportBreakdown,
  resolveRouteDistance,
};
