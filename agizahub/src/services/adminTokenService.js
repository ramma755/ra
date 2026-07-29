const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { query, transaction } = require("../config/db");
const env = require("../config/env");
const { normalizeMsisdn } = require("./darajaService");

const normalizeAdminPhone = (phone) => normalizeMsisdn(String(phone || "").replace("whatsapp:+", ""));

const issueAdminAccessToken = async ({ adminPhone }) => {
  const normalized = normalizeAdminPhone(adminPhone);
  const token = crypto.randomInt(0, 10000).toString().padStart(4, "0");
  const tokenHash = await bcrypt.hash(token, 10);

  await query(
    `
      INSERT INTO admin_access_tokens (
        admin_phone,
        token_hash,
        expires_at
      )
      VALUES ($1, $2, NOW() + ($3::text || ' minutes')::interval)
    `,
    [normalized, tokenHash, String(env.admin.tokenTtlMinutes)]
  );

  return {
    token,
    expiresInMinutes: env.admin.tokenTtlMinutes,
  };
};

const verifyAdminAccessToken = async ({ adminPhone, token }) => {
  const normalized = normalizeAdminPhone(adminPhone);
  return transaction(async (client) => {
    const tokenResult = await client.query(
      `
        SELECT *
        FROM admin_access_tokens
        WHERE admin_phone = $1
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [normalized]
    );

    if (tokenResult.rowCount === 0) {
      return { ok: false, reason: "NO_TOKEN" };
    }
    const row = tokenResult.rows[0];
    const now = new Date();
    if (!row.expires_at || new Date(row.expires_at) < now) {
      await client.query(
        `UPDATE admin_access_tokens SET consumed_at = NOW(), attempts = attempts + 1 WHERE id = $1`,
        [row.id]
      );
      return { ok: false, reason: "EXPIRED" };
    }

    const matches = await bcrypt.compare(String(token || "").trim(), row.token_hash);
    if (!matches) {
      await client.query(
        `UPDATE admin_access_tokens SET attempts = attempts + 1 WHERE id = $1`,
        [row.id]
      );
      if (Number(row.attempts || 0) + 1 >= env.admin.tokenMaxAttempts) {
        await client.query(`UPDATE admin_access_tokens SET consumed_at = NOW() WHERE id = $1`, [
          row.id,
        ]);
      }
      return { ok: false, reason: "INVALID" };
    }

    await client.query(`UPDATE admin_access_tokens SET consumed_at = NOW() WHERE id = $1`, [row.id]);
    await client.query(
      `
        INSERT INTO admin_access_sessions (
          admin_phone,
          verified_until,
          updated_at
        )
        VALUES ($1, NOW() + ($2::text || ' minutes')::interval, NOW())
        ON CONFLICT (admin_phone)
        DO UPDATE SET
          verified_until = EXCLUDED.verified_until,
          updated_at = NOW()
      `,
      [normalized, String(env.admin.sessionTtlMinutes)]
    );

    return {
      ok: true,
      verifiedForMinutes: env.admin.sessionTtlMinutes,
    };
  });
};

const isAdminSessionActive = async ({ adminPhone }) => {
  const normalized = normalizeAdminPhone(adminPhone);
  const session = await query(
    `
      SELECT 1
      FROM admin_access_sessions
      WHERE admin_phone = $1
        AND verified_until > NOW()
      LIMIT 1
    `,
    [normalized]
  );
  return session.rowCount > 0;
};

const revokeAdminSession = async ({ adminPhone }) => {
  const normalized = normalizeAdminPhone(adminPhone);
  await query(`DELETE FROM admin_access_sessions WHERE admin_phone = $1`, [normalized]);
};

module.exports = {
  issueAdminAccessToken,
  verifyAdminAccessToken,
  isAdminSessionActive,
  revokeAdminSession,
};
