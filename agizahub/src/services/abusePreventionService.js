const { transaction, query } = require("../config/db");

const registerSenderMessage = async ({ phoneNumber }) => {
  const now = new Date();
  return transaction(async (client) => {
    await client.query(
      `
        INSERT INTO sender_abuse_controls (
          phone_number,
          window_started_at,
          request_count,
          updated_at
        )
        VALUES ($1, NOW(), 0, NOW())
        ON CONFLICT (phone_number) DO NOTHING
      `,
      [phoneNumber]
    );

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
    const windowStartedAt = row.window_started_at ? new Date(row.window_started_at) : now;
    const windowAgeMs = now.getTime() - windowStartedAt.getTime();
    const sameWindow = windowAgeMs < 60 * 1000;
    const requestCount = sameWindow ? Number(row.request_count || 0) + 1 : 1;
    const violationCount = Number(row.violation_count || 0);

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
        mutedUntil ? mutedUntil.toISOString() : null,
        bannedUntil ? bannedUntil.toISOString() : null,
        violationCount,
      ]
    );

    return {
      allowed: true,
      blockedReason: null,
      mutedUntil: null,
      bannedUntil: null,
      newlyMuted: false,
      newlyBanned: false,
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
  await query(
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
    `,
    [phoneNumber]
  );
};

module.exports = {
  registerSenderMessage,
  clearSenderBlocks,
  incrementSenderFailure,
};
