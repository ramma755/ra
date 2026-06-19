const fs = require("fs/promises");
const path = require("path");
const { pool } = require("../config/db");

const run = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGSERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = __dirname;
    const allFiles = (await fs.readdir(migrationsDir))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();

    for (const file of allFiles) {
      const exists = await client.query(
        `SELECT 1 FROM schema_migrations WHERE filename = $1`,
        [file]
      );
      if (exists.rowCount > 0) {
        // eslint-disable-next-line no-console
        console.log(`Skipping ${file}, already applied`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      // eslint-disable-next-line no-console
      console.log(`Applying ${file}`);
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (filename) VALUES ($1)`,
        [file]
      );
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed:", error.message);
  process.exit(1);
});
