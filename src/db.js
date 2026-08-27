const { Pool } = require("pg");

// Railway's Postgres plugin injects DATABASE_URL automatically once attached
// to this service — nothing to configure by hand beyond adding the plugin.
if (!process.env.DATABASE_URL) {
  console.warn(
    "[db] DATABASE_URL is not set. Add a Postgres plugin in Railway and " +
      "attach it to this service — Railway wires the variable in for you."
  );
}

// Railway's private network (host ends in .railway.internal) doesn't speak
// TLS on the Postgres port — forcing SSL there hangs the connection. Public
// Postgres endpoints (Railway's proxy domain, or any other host) generally
// do need it. Detect by hostname rather than guessing from the whole string.
function shouldUseSsl(connectionString) {
  if (!connectionString) return false;
  try {
    const host = new URL(connectionString).hostname;
    return !host.endsWith(".railway.internal") && host !== "localhost" && host !== "127.0.0.1";
  } catch {
    return false;
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUseSsl(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (err) => {
  // Fires for errors on idle clients in the pool (e.g. a dropped connection)
  // — without this handler, Node treats it as an unhandled 'error' event and
  // crashes the whole process.
  console.error("[db] pool error:", err.message);
});

module.exports = { pool };
