const { transaction, query } = require("../config/db");
const env = require("../config/env");

const registerSenderMessage = async ({ phoneNumber }) => {
  const now = new Date();
  return transaction(async (client) => {
    const existing = await client.query(
      `
        SELECT *
        FROM sender_abuse_controls
        WHERE phone_number = $1
        FOR UPDATE
      `,
      [phoneNumber]
    );

    if (existing.rowCount === 0) {
      await client.query(
        `
          INSERT INTO sender_abuse_controls (
            phone_number,
            window_started_at,
            request_count,
            updated_at
          )
          VALUES ($1, NOW(), 1, NOW())
        `,
        [phoneNumber]
      );
      return {
        allowed: true,
        blockedReason: null,
        mutedUntil: null,
        bannedUntil: null,
        newlyMuted: false,
        newlyBanned: false,
      };
    }

    const row = existing.rows[0];
    const bannedUntil = row.banned_until ? new Date(row.banned_until) : null;
    const mutedUntil = row.muted_until ? new Date(row.muted_until) : null;
    if (bannedUntil && bannedUntil > now) {
      return {
        allowed: false,
        blockedReason: "BANNED",
        mutedUntil: null,
        bannedUntil,
        newlyMuted: false,
        newlyBanned: false,
      };
    }
    if (mutedUntil && mutedUntil > now) {
      return {
        allowed: false,
        blockedReason: "MUTED",
        mutedUntil,
        bannedUntil: null,
        newlyMuted: false,
        newlyBanned: false,
      };
    }

    const windowStartedAt = row.window_started_at ? new Date(row.window_started_at) : now;
    const windowAgeMs = now.getTime() - windowStartedAt.getTime();
    const sameWindow = windowAgeMs < 60 * 1000;
    const requestCount = sameWindow ? Number(row.request_count || 0) + 1 : 1;

    let violationCount = Number(row.violation_count || 0);
    let nextMutedUntil = null;
    let nextBannedUntil = null;
    let blockedReason = null;
    let newlyMuted = false;
    let newlyBanned = false;

    if (requestCount > env.security.maxMessagesPerPhonePerMinute) {
      violationCount += 1;
      blockedReason = "MUTED";
      newlyMuted = true;
      nextMutedUntil = new Date(now.getTime() + env.security.muteMinutesOnFlood * 60 * 1000);

      if (violationCount >= env.security.autoBanAfterViolations) {
        blockedReason = "BANNED";
        newlyBanned = true;
        nextBannedUntil = new Date(now.getTime() + env.security.banMinutes * 60 * 1000);
        nextMutedUntil = null;
      }
    }

    await client.query(
      `
        UPDATE sender_abuse_controls
        SET window_started_at = $2,
            request_count = $3,
            muted_until = $4,
            banned_until = $5,
            violation_count = $6,
            updated_at = NOW()
        WHERE phone_number = $1
      `,
      [
        phoneNumber,
        sameWindow ? row.window_started_at : now.toISOString(),
        requestCount,
        nextMutedUntil ? nextMutedUntil.toISOString() : null,
        nextBannedUntil ? nextBannedUntil.toISOString() : null,
        violationCount,
      ]
    );

    return {
      allowed: !blockedReason,
      blockedReason,
      mutedUntil: nextMutedUntil,
      bannedUntil: nextBannedUntil,
      newlyMuted,
      newlyBanned,
    };
  });
};

const clearSenderBlocks = async ({ phoneNumber }) => {
  await query(
    `
      UPDATE sender_abuse_controls
      SET muted_until = NULL,
          banned_until = NULL,
          violation_count = 0,
          failed_attempts = 0,
          updated_at = NOW()
      WHERE phone_number = $1
    `,
    [phoneNumber]
  );
};

const incrementSenderFailure = async ({ phoneNumber }) => {
  const result = await query(
    `
      INSERT INTO sender_abuse_controls (
        phone_number,
        window_started_at,
        request_count,
        failed_attempts,
        updated_at
      )
      VALUES ($1, NOW(), 0, 1, NOW())
      ON CONFLICT (phone_number)
      DO UPDATE SET
        failed_attempts = sender_abuse_controls.failed_attempts + 1,
        updated_at = NOW()
      RETURNING failed_attempts
    `,
    [phoneNumber]
  );

  const failures = Number(result.rows?.[0]?.failed_attempts || 0);
  if (failures >= env.security.autoBanAfterViolations) {
    await query(
      `
        UPDATE sender_abuse_controls
        SET banned_until = NOW() + ($2::text || ' minutes')::interval,
            updated_at = NOW()
        WHERE phone_number = $1
      `,
      [phoneNumber, String(env.security.banMinutes)]
    );
  }
};

module.exports = {
  registerSenderMessage,
  clearSenderBlocks,
  incrementSenderFailure,
};
