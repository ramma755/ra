const { query, transaction } = require("../config/db");

const normalizeCorridor = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const inferredVehicleType = (profile) => {
  if (profile.transporter_vehicle_type) {
    return profile.transporter_vehicle_type;
  }
  if (profile.user_type === "TRANSPORTER_BIKE") {
    return "MOTORBIKE";
  }
  if (profile.user_type === "TRANSPORTER_TRUCK") {
    return "CANTER_TRUCK";
  }
  return null;
};

const isVehicleEligible = (requestedVehicleType, driverVehicleType) => {
  if (!requestedVehicleType || !driverVehicleType) return false;
  if (requestedVehicleType === driverVehicleType) return true;
  if (requestedVehicleType === "TUKTUK_PICKUP") {
    return ["TUKTUK_PICKUP", "CANTER_TRUCK"].includes(driverVehicleType);
  }
  if (requestedVehicleType === "CANTER_TRUCK") {
    return driverVehicleType === "CANTER_TRUCK";
  }
  return false;
};

const isCorridorEligible = ({
  driverCorridor,
  pickupLocationLabel,
  dropoffLocationLabel,
}) => {
  const normalizedDriver = normalizeCorridor(driverCorridor);
  if (!normalizedDriver || normalizedDriver === "any") return true;
  const pickup = normalizeCorridor(pickupLocationLabel);
  const dropoff = normalizeCorridor(dropoffLocationLabel);
  return pickup.includes(normalizedDriver) || dropoff.includes(normalizedDriver);
};

const corridorKeyForOrder = ({ pickupLocationLabel, dropoffLocationLabel }) =>
  `${normalizeCorridor(pickupLocationLabel)}->${normalizeCorridor(dropoffLocationLabel)}`;

const enqueueTransportJobBroadcasts = async ({
  orderId,
  requestedVehicleType,
  pickupLocationLabel,
  dropoffLocationLabel,
}) => {
  const profiles = await query(
    `
      SELECT masked_id, user_type, transporter_vehicle_type, service_corridor_label
      FROM platform_users
      WHERE user_type IN ('TRANSPORTER_BIKE', 'TRANSPORTER_TRUCK')
        AND current_step = 'COMPLETED'
    `
  );

  const eligibleDriverIds = profiles.rows
    .filter((profile) =>
      isVehicleEligible(requestedVehicleType, inferredVehicleType(profile))
    )
    .filter((profile) =>
      isCorridorEligible({
        driverCorridor: profile.service_corridor_label,
        pickupLocationLabel,
        dropoffLocationLabel,
      })
    )
    .map((profile) => profile.masked_id);

  if (eligibleDriverIds.length === 0) {
    return {
      queuedDrivers: 0,
      corridorKey: corridorKeyForOrder({ pickupLocationLabel, dropoffLocationLabel }),
    };
  }

  const corridorKey = corridorKeyForOrder({
    pickupLocationLabel,
    dropoffLocationLabel,
  });

  for (const driverMaskedId of eligibleDriverIds) {
    await query(
      `
        INSERT INTO transport_job_broadcasts (
          order_id,
          driver_masked_id,
          requested_vehicle_type,
          corridor_key,
          status,
          sent_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, 'SENT', NOW(), NOW())
        ON CONFLICT (order_id, driver_masked_id)
        DO UPDATE SET
          requested_vehicle_type = EXCLUDED.requested_vehicle_type,
          corridor_key = EXCLUDED.corridor_key,
          status = 'SENT',
          sent_at = NOW(),
          updated_at = NOW(),
          skip_reason = NULL
      `,
      [orderId, driverMaskedId, requestedVehicleType, corridorKey]
    );
  }

  return {
    queuedDrivers: eligibleDriverIds.length,
    corridorKey,
  };
};

const listQueuedJobsForDriver = async ({ driverMaskedId }) => {
  const result = await query(
    `
      SELECT
        b.order_id AS id,
        o.transport_job_category,
        o.pickup_location_label,
        o.delivery_location,
        o.requested_vehicle_type,
        o.raw_transport_fee_kes,
        b.corridor_key,
        b.status,
        b.created_at
      FROM transport_job_broadcasts b
      JOIN orders o ON o.id = b.order_id
      WHERE b.driver_masked_id = $1
        AND b.status IN ('PENDING', 'SENT')
        AND o.order_type = 'TRANSPORT_ONLY'
        AND o.transporter_masked_id IS NULL
        AND o.payment_status IN ('PENDING_PAYMENT', 'PAID_HELD')
      ORDER BY b.created_at DESC
      LIMIT 10
    `,
    [driverMaskedId]
  );

  return result.rows;
};

const claimBroadcastJob = async ({ orderId, driverMaskedId }) => {
  return transaction(async (client) => {
    const queueResult = await client.query(
      `
        SELECT id
        FROM transport_job_broadcasts
        WHERE order_id = $1
          AND driver_masked_id = $2
          AND status IN ('PENDING', 'SENT')
        FOR UPDATE
      `,
      [orderId, driverMaskedId]
    );
    if (queueResult.rowCount === 0) {
      throw new Error("No queued broadcast for this driver/job");
    }

    const orderUpdate = await client.query(
      `
        UPDATE orders
        SET transporter_masked_id = $2,
            updated_at = NOW()
        WHERE id = $1
          AND order_type = 'TRANSPORT_ONLY'
          AND transporter_masked_id IS NULL
        RETURNING id, pickup_location_label, delivery_location, requested_vehicle_type
      `,
      [orderId, driverMaskedId]
    );
    if (orderUpdate.rowCount === 0) {
      throw new Error("Transport job already claimed");
    }

    await client.query(
      `
        UPDATE transport_job_broadcasts
        SET status = 'CLAIMED',
            claimed_at = NOW(),
            updated_at = NOW()
        WHERE order_id = $1
          AND driver_masked_id = $2
      `,
      [orderId, driverMaskedId]
    );

    await client.query(
      `
        UPDATE transport_job_broadcasts
        SET status = 'SKIPPED',
            skip_reason = 'Claimed by another driver',
            updated_at = NOW()
        WHERE order_id = $1
          AND driver_masked_id <> $2
          AND status IN ('PENDING', 'SENT')
      `,
      [orderId, driverMaskedId]
    );

    await client.query(
      `
        INSERT INTO admin_action_events (
          order_id,
          actor_phone,
          action_type,
          action_payload
        )
        VALUES ($1, $2, 'TRANSPORT_JOB_CLAIMED', $3)
      `,
      [
        orderId,
        driverMaskedId,
        JSON.stringify({
          orderId,
          driverMaskedId,
        }),
      ]
    );

    return orderUpdate.rows[0];
  });
};

module.exports = {
  enqueueTransportJobBroadcasts,
  listQueuedJobsForDriver,
  claimBroadcastJob,
};
