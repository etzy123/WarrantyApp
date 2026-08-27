const { Pool } = require("pg");

// Railway's Postgres plugin injects DATABASE_URL automatically once attached
// to this service — nothing to configure by hand beyond adding the plugin.
if (!process.env.DATABASE_URL) {
  console.warn(
    "[db] DATABASE_URL is not set. Add a Postgres plugin in Railway and " +
      "attach it to this service — Railway wires the variable in for you."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("railway")
    ? { rejectUnauthorized: false }
    : undefined,
});

module.exports = { pool };
