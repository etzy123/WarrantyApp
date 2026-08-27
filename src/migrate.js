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

  // The rest of the store's vendors, pulled from Shopify's full vendor list
  // (productVendors) rather than the sales-ranked top 10 above — so every
  // brand carried in the catalog has a row here and can get a real contact
  // entered from the ops dashboard, not just the best sellers. No sales data
  // pulled for these (units_sold defaults to 0), so they sort to the bottom
  // of the ops directory until that's backfilled.
  //
  // NOTE: Shopify's vendor field is free text, and a few brands are entered
  // inconsistently — "Adidas" / "adidas" / "adidas Golf Originals" and
  // "YETI" / "Yeti" all appear as separate vendor strings. They're kept as
  // separate rows here (merging them would be a guess), but since claim
  // routing matches a product's vendor to a brand name exactly, a claim for
  // a product tagged "Adidas" won't match a contact entered under "adidas".
  // Worth cleaning up the vendor spelling in Shopify itself if that matters.
  ...[
    "Adidas", "adidas", "Anderson's", "APC Golf", "AS2OV Golf", "Bagjack Golf", "Baracuta",
    "Blue Tees", "Bogner", "Bushnell", "Ciel Glue", "Clif", "Cole Haan", "CPH Golf",
    "Dimple & Divot", "Eastside Golf", "Ecco", "Fella Golf", "Fyfe Golf", "G/FORE", "Garmin",
    "Garmin Golf", "Ghost Golf", "Goatlane", "Golden Soul Golf", "Head Golf", "Hestra",
    "J. Lindeberg", "Jain Golf", "Jason Markk", "Jones Golf", "Kiffe Golf", "Kjus", "Lacoste",
    "Left of Field Golf", "Local Rule", "Lost Balls", "Macade", "Marsh Maille", "master-piece",
    "MIIR", "Mileseey", "Minimal Golf", "Motocaddy", "New Balance Golf", "Nikon", "Oakley",
    "Parel Studios", "Pas Normal Studios", "Pluto Golf", "Pop Trading Company", "Public Drip",
    "Puma", "Quiet Golf", "Scotty Cameron", "Spektrum", "Sportr", "Stance", "Students Golf",
    "Sunspel", "Tired", "Trophy Hunting", "Vessel Golf", "YETI", "Yeti", "Zero Friction",
  ].map((name) => ({ name, units_sold: 0, house: false, contact_role: null, contact_email: null })),
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

  // Added later, for the brand invoice feature — ALTER rather than baked
  // into CREATE TABLE so this applies cleanly to databases that already have
  // a claims table from before this column existed.
  await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS order_date TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS quantity INTEGER;`);
  await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2);`);
  await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS currency TEXT;`);
  await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMPTZ;`);

  await pool.query(`CREATE INDEX IF NOT EXISTS claims_stage_idx ON claims (stage);`);

  // Photos a customer attaches to a claim at submission time. Stored directly
  // in Postgres (bytea) rather than an external bucket — simplest option at
  // this scale, and keeps everything in one place to back up.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS claim_photos (
      id          SERIAL PRIMARY KEY,
      claim_id    TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      filename    TEXT,
      mime_type   TEXT NOT NULL,
      data        BYTEA NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS claim_photos_claim_idx ON claim_photos (claim_id);`);

  // Single editable row holding the outgoing brand-notification email
  // template. Kept separate from hardcoded strings in email.js so it can be
  // edited from the ops dashboard without a redeploy.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_template (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      subject     TEXT NOT NULL,
      body        TEXT NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (id = 1)
    );
  `);
  await pool.query(
    `INSERT INTO email_template (id, subject, body)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [
      "Warranty claim {{claim_id}} — {{product_title}}",
      "Hi {{contact_role}},\n\n" +
        "Bisque Golf has a warranty claim for a {{product_title}}{{sku_suffix}}, order #{{order_number}}.\n\n" +
        'Reported issue: "{{issue}}"\n\n' +
        "Could you advise on next steps — replacement, repair, or more info needed?\n\n" +
        "Reference: {{claim_id}}",
    ]
  );

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
