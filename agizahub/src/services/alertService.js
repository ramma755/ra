const logger = require("./logger");
const env = require("../config/env");
const { query } = require("../config/db");

const sendOpsAlert = async ({ level, message, payload }) => {
  logger.warn("OPS ALERT", { level, message, payload });
};

const queueAdminAlert = async ({
  templateKey,
  channel,
  destination,
  messageText,
  payload,
}) => {
  await query(
    `
      INSERT INTO admin_notifications_outbox (
        template_key,
        channel,
        destination,
        message_text,
        payload,
        status
      )
      VALUES ($1,$2,$3,$4,$5,'QUEUED')
    `,
    [templateKey, channel, destination, messageText, JSON.stringify(payload || {})]
  );
};

const buildTransporterTimeoutAlert = ({
  orderId,
  orderType,
  pickupLocationLabel,
  dropoffLocationLabel,
  requestedVehicleType,
  previousTransporter,
  newTransporter,
  timeoutMinutes,
  reassigned,
  rebroadcastedDrivers,
}) => {
  const header = reassigned
    ? `AUTO-REMATCH EXECUTED: Order #${orderId}`
    : `TIMEOUT UNASSIGNED: Order #${orderId}`;
  const outcomeLine = reassigned
    ? `New Transporter: #${newTransporter}`
    : `No immediate replacement. Re-broadcasted to ${rebroadcastedDrivers} drivers.`;

  const messageText = [
    "TRANSPORT TIMEOUT ALERT",
    "--------------------------",
    header,
    `Order Type: ${orderType}`,
    `Route: ${pickupLocationLabel} -> ${dropoffLocationLabel}`,
    `Vehicle: ${requestedVehicleType}`,
    `Timed-out Transporter: #${previousTransporter || "N/A"}`,
    outcomeLine,
    `Timeout Window: ${timeoutMinutes} minutes`,
  ].join("\n");

  return {
    templateKey: "TRANSPORTER_TIMEOUT_REMATCH",
    messageText,
    payload: {
      orderId,
      orderType,
      pickupLocationLabel,
      dropoffLocationLabel,
      requestedVehicleType,
      previousTransporter,
      newTransporter: newTransporter || null,
      timeoutMinutes,
      reassigned,
      rebroadcastedDrivers: rebroadcastedDrivers || 0,
    },
  };
};

const sendTransporterTimeoutAlert = async (event) => {
  const alert = buildTransporterTimeoutAlert(event);
  const channel = env.admin.alertChannel || "WHATSAPP";
  const destination =
    env.admin.whatsappPhone || env.admin.alertFallbackDestination || "admin-dashboard";

  await queueAdminAlert({
    templateKey: alert.templateKey,
    channel,
    destination,
    messageText: alert.messageText,
    payload: alert.payload,
  });

  logger.warn("ADMIN TRANSPORT ALERT QUEUED", {
    channel,
    destination,
    orderId: event.orderId,
    reassigned: event.reassigned,
  });
};

module.exports = {
  sendOpsAlert,
  queueAdminAlert,
  buildTransporterTimeoutAlert,
  sendTransporterTimeoutAlert,
};
