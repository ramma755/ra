const { Pool } = require("pg");
const env = require("./env");

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl:
    env.nodeEnv === "production"
      ? {
          rejectUnauthorized: false,
        }
      : false,
});

const query = (text, params = []) => pool.query(text, params);

const transaction = async (workFn) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await workFn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  query,
  transaction,
};
