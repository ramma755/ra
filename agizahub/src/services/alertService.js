const logger = require("./logger");
const env = require("../config/env");
const { query } = require("../config/db");
const { sendGatewayReply } = require("./whatsappGatewayService");
const { normalizeMsisdn } = require("./darajaService");

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

const resolveAdminPhones = () => {
  const configured = Array.isArray(env.admin.whatsappPhones) ? env.admin.whatsappPhones : [];
  return Array.from(
    new Set(
      configured
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .map((value) => normalizeMsisdn(value.replace("whatsapp:+", "")))
        .filter(Boolean)
    )
  );
};

const pushImmediateWhatsappAdminAlert = async ({ messageText }) => {
  const phones = resolveAdminPhones();
  if (phones.length === 0) {
    logger.warn("ADMIN ALERT SKIPPED: no admin phones configured for immediate push");
    return;
  }

  let delivered = 0;
  for (const phone of phones) {
    try {
      await sendGatewayReply({
        provider: env.whatsappGateway.provider,
        toPhone: phone,
        message: messageText,
      });
      delivered += 1;
    } catch (error) {
      logger.error("ADMIN ALERT DIRECT PUSH FAILED", {
        phone,
        error: error.message,
      });
    }
  }

  logger.info("ADMIN ALERT DIRECT PUSH RESULT", {
    delivered,
    attempted: phones.length,
  });
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
  if (String(channel || "").toUpperCase() === "WHATSAPP") {
    await pushImmediateWhatsappAdminAlert({
      messageText: alert.messageText,
    });
  }

  logger.warn("ADMIN TRANSPORT ALERT QUEUED", {
    channel,
    destination,
    orderId: event.orderId,
    reassigned: event.reassigned,
  });
};

const sendDisputeEscalationAlert = async ({
  orderId,
  issueType,
  reporterPhone,
  note,
  payload,
}) => {
  const channel = env.admin.alertChannel || "WHATSAPP";
  const destination =
    env.admin.whatsappPhone || env.admin.alertFallbackDestination || "admin-dashboard";

  const messageText = [
    "PRIORITY SUPPORT ESCALATION",
    "--------------------------",
    `Order: #${orderId || "N/A"}`,
    `Issue: ${issueType}`,
    `Reporter: ${reporterPhone || "unknown"}`,
    `Note: ${note || "n/a"}`,
  ].join("\n");

  await queueAdminAlert({
    templateKey: "DISPUTE_ESCALATION",
    channel,
    destination,
    messageText,
    payload: payload || { orderId, issueType, reporterPhone, note },
  });
  if (String(channel || "").toUpperCase() === "WHATSAPP") {
    await pushImmediateWhatsappAdminAlert({
      messageText,
    });
  }
};

module.exports = {
  sendOpsAlert,
  queueAdminAlert,
  buildTransporterTimeoutAlert,
  sendTransporterTimeoutAlert,
  sendDisputeEscalationAlert,
};
