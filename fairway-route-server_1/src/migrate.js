// Creates/updates schema and seeds the brand directory. Runs automatically on
// boot (see index.js) and can also be run by hand with `npm run migrate`.
const { pool } = require("./db");

const SEED_BRANDS = [
  // Seeded from a one-time pull of Shopify sales analytics (units sold,
  // trailing 12 months). Re-run this seed periodically, or replace it with a
  // scheduled job that refreshes from ShopifyQL, to keep the ranking current.
  { name: "Nike Golf", units_sold: 5963, house: false, contact_role: "Wholesale Returns", contact_email: "returns@nikegolf-partners.com" },
  { name: "Bisque Golf", units_sold: 3411, house: true, contact_role: null, contact_email: null },
  { name: "Manors Golf", units_sold: 1841, house: false, contact_role: "Trade Support", contact_email: "trade@manorsgolf-partners.com" },
  { name: "Jordan Golf", units_sold: 1757, house: false, contact_role: "Wholesale Care", contact_email: "wholesale.care@jordangolf-partners.com" },
  { name: "Malbon Golf", units_sold: 1380, house: false, contact_role: "Partner Support", contact_email: "partners@malbongolf-partners.com" },
  { name: "Titleist", units_sold: 1202, house: false, contact_role: "Dealer Claims", contact_email: "dealerclaims@titleist-partners.com" },
  { name: "FootJoy", units_sold: 1010, house: false, contact_role: "Warranty Support", contact_email: "warranty@footjoy-partners.com" },
  { name: "adidas Golf Originals", units_sold: 772, house: false, contact_role: "B2B Returns", contact_email: "b2breturns@adidasgolf-partners.com" },
  { name: "3 Putt Round", units_sold: 595, house: false, contact_role: "Customer Care", contact_email: "care@3puttround-partners.com" },
  { name: "Payntr Golf", units_sold: 368, house: false, contact_role: "Warranty Team", contact_email: "warranty@payntrgolf-partners.com" },
];

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brands (
      name          TEXT PRIMARY KEY,
      units_sold    INTEGER NOT NULL DEFAULT 0,
      house         BOOLEAN NOT NULL DEFAULT FALSE,
      contact_role  TEXT,
      contact_email TEXT,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS claims (
      id              TEXT PRIMARY KEY,
      order_number    TEXT,
      customer_name   TEXT,
      customer_email  TEXT,
      brand_name      TEXT REFERENCES brands(name),
      routing_type    TEXT NOT NULL CHECK (routing_type IN ('external','house','ambiguous')),
      product_title   TEXT,
      sku             TEXT,
      issue           TEXT,
      stage           TEXT NOT NULL DEFAULT 'submitted'
                        CHECK (stage IN ('submitted','routed','processing','resolved','attention')),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS claims_stage_idx ON claims (stage);`);

  // Holds the offline access token obtained via the OAuth install flow
  // (see shopifyAuth.js) — one row per shop this app has been installed to.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shopify_credentials (
      shop_domain   TEXT PRIMARY KEY,
      access_token  TEXT NOT NULL,
      scope         TEXT,
      installed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Short-lived install nonces for OAuth CSRF protection (see shopifyAuth.js).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shopify_oauth_state (
      state       TEXT PRIMARY KEY,
      shop_domain TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  for (const b of SEED_BRANDS) {
    await pool.query(
      `INSERT INTO brands (name, units_sold, house, contact_role, contact_email)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (name) DO NOTHING`,
      [b.name, b.units_sold, b.house, b.contact_role, b.contact_email]
    );
  }

  console.log("[migrate] schema ready, brands seeded (skips brands that already exist).");
}

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { migrate };
