const env = require("../config/env");
const { query, transaction } = require("../config/db");
const {
  findEligibleDrivers,
  enqueueTransportJobBroadcasts,
} = require("./transportBroadcastService");

const defaultRequestedVehicle = (order) =>
  order.requested_vehicle_type || "TUKTUK_PICKUP";

const reassignOrderTransporter = async (order) => {
  const requestedVehicleType = defaultRequestedVehicle(order);
  const pickupLocationLabel = order.pickup_location_label || "unknown-pickup";
  const dropoffLocationLabel = order.delivery_location || "unknown-dropoff";

  const eligibleDrivers = await findEligibleDrivers({
    requestedVehicleType,
    pickupLocationLabel,
    dropoffLocationLabel,
    excludeDriverMaskedIds: [order.transporter_masked_id],
  });

  if (eligibleDrivers.length === 0) {
    await transaction(async (client) => {
      await client.query(
        `
          UPDATE orders
          SET transporter_masked_id = NULL,
              transporter_assigned_at = NULL,
              transporter_reassignment_count = transporter_reassignment_count + 1,
              updated_at = NOW()
          WHERE id = $1
        `,
        [order.id]
      );

      await client.query(
        `
          UPDATE transport_job_broadcasts
          SET status = 'EXPIRED',
              skip_reason = 'Timed out without delivery confirmation',
              updated_at = NOW()
          WHERE order_id = $1
            AND driver_masked_id = $2
            AND status IN ('PENDING', 'SENT', 'CLAIMED')
        `,
        [order.id, order.transporter_masked_id]
      );

      await client.query(
        `
          INSERT INTO admin_action_events (
            order_id,
            actor_phone,
            action_type,
            action_payload
          )
          VALUES ($1, 'system', 'TRANSPORTER_TIMEOUT_UNASSIGNED', $2)
        `,
        [
          order.id,
          JSON.stringify({
            previousTransporter: order.transporter_masked_id,
          }),
        ]
      );
    });

    const rebroadcast = await enqueueTransportJobBroadcasts({
      orderId: order.id,
      requestedVehicleType,
      pickupLocationLabel,
      dropoffLocationLabel,
      excludeDriverMaskedIds: [order.transporter_masked_id],
    });

    return {
      orderId: order.id,
      reassigned: false,
      rebroadcastedDrivers: rebroadcast.queuedDrivers,
    };
  }

  const nextDriver = eligibleDrivers[0].maskedId;

  await transaction(async (client) => {
    await client.query(
      `
        UPDATE orders
        SET transporter_masked_id = $2,
            transporter_assigned_at = NOW(),
            transporter_reassignment_count = transporter_reassignment_count + 1,
            updated_at = NOW()
        WHERE id = $1
      `,
      [order.id, nextDriver]
    );

    await client.query(
      `
        UPDATE transport_job_broadcasts
        SET status = 'EXPIRED',
            skip_reason = 'Timed out without delivery confirmation',
            updated_at = NOW()
        WHERE order_id = $1
          AND driver_masked_id = $2
          AND status IN ('PENDING', 'SENT', 'CLAIMED')
      `,
      [order.id, order.transporter_masked_id]
    );

    await client.query(
      `
        INSERT INTO transport_job_broadcasts (
          order_id,
          driver_masked_id,
          requested_vehicle_type,
          corridor_key,
          status,
          sent_at,
          claimed_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, 'CLAIMED', NOW(), NOW(), NOW())
        ON CONFLICT (order_id, driver_masked_id)
        DO UPDATE SET
          requested_vehicle_type = EXCLUDED.requested_vehicle_type,
          corridor_key = EXCLUDED.corridor_key,
          status = 'CLAIMED',
          sent_at = NOW(),
          claimed_at = NOW(),
          updated_at = NOW(),
          skip_reason = NULL
      `,
      [
        order.id,
        nextDriver,
        requestedVehicleType,
        `${pickupLocationLabel}->${dropoffLocationLabel}`,
      ]
    );

    await client.query(
      `
        UPDATE transport_job_broadcasts
        SET status = 'SKIPPED',
            skip_reason = 'Auto-rematched to alternate transporter',
            updated_at = NOW()
        WHERE order_id = $1
          AND driver_masked_id <> $2
          AND status IN ('PENDING', 'SENT')
      `,
      [order.id, nextDriver]
    );

    await client.query(
      `
        INSERT INTO admin_action_events (
          order_id,
          actor_phone,
          action_type,
          action_payload
        )
        VALUES ($1, 'system', 'TRANSPORTER_TIMEOUT_REASSIGNED', $2)
      `,
      [
        order.id,
        JSON.stringify({
          previousTransporter: order.transporter_masked_id,
          newTransporter: nextDriver,
          requestedVehicleType,
        }),
      ]
    );
  });

  return {
    orderId: order.id,
    reassigned: true,
    previousTransporter: order.transporter_masked_id,
    newTransporter: nextDriver,
  };
};

const runTransporterTimeoutReassignment = async () => {
  const timeoutMinutes = Number(env.businessRules.transporterAssignmentTimeoutMinutes);
  const threshold = new Date(Date.now() - timeoutMinutes * 60 * 1000);

  const candidates = await query(
    `
      SELECT
        id,
        order_type,
        requested_vehicle_type,
        pickup_location_label,
        delivery_location,
        transporter_masked_id,
        transporter_assigned_at
      FROM orders
      WHERE transporter_masked_id IS NOT NULL
        AND transporter_assigned_at IS NOT NULL
        AND transporter_assigned_at <= $1
        AND release_requested_at IS NULL
        AND payment_status IN ('PENDING_PAYMENT', 'PAID_HELD')
        AND settlement_status IN ('NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD')
      ORDER BY transporter_assigned_at ASC
      LIMIT 50
    `,
    [threshold.toISOString()]
  );

  const outcomes = [];
  for (const order of candidates.rows) {
    // eslint-disable-next-line no-await-in-loop
    outcomes.push(await reassignOrderTransporter(order));
  }

  return {
    timeoutMinutes,
    scanned: candidates.rowCount,
    reassigned: outcomes.filter((item) => item.reassigned).length,
    unassigned: outcomes.filter((item) => !item.reassigned).length,
  };
};

module.exports = {
  runTransporterTimeoutReassignment,
};
