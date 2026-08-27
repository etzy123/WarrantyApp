# Bisque Golf Warranty Claims — deploy guide

A small Node/Express app: customer-facing warranty form, an internal ops
dashboard, a Postgres-backed claims queue, live Shopify order lookup, and
Resend for the actual emails.

## What you need before deploying

1. A **Railway** account (railway.app) — for hosting + Postgres.
2. A **Resend** account (resend.com) — for sending real emails. Free tier is
   plenty to start; you'll add a "sending domain" later to send as
   `@bisquegolf.com` instead of Resend's shared test address.
3. An app in Shopify's **Dev Dashboard** (dev.shopify.com) with the
   `read_orders,read_products` scopes. Unlike the old legacy custom-app
   screen, this doesn't hand you a static token up front — the app
   connects itself via a one-time OAuth install after it's deployed (step 5
   below). What you need from the Dev Dashboard right away is just the
   app's **Client ID** and **Client secret**, shown on its API credentials
   page without any OAuth step.

## Deploying

1. Push this folder to a new GitHub repo, or deploy it directly with the
   Railway CLI (`railway up` from inside this folder) — no GitHub required.
2. In the Railway project: **New → Database → PostgreSQL**. Railway wires
   `DATABASE_URL` into this service automatically once the plugin is
   attached — nothing to copy by hand.
3. In the service's **Variables** tab, add:
   - `APP_URL` — this service's public Railway URL (e.g.
     `https://fairway-route.up.railway.app`) — Railway shows it once the
     service has a domain generated (Settings → Networking → Generate
     Domain, if it's not already assigned one).
   - `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` — from the Dev Dashboard app's
     API credentials page.
   - `RESEND_API_KEY` — from Resend.
   - `EMAIL_FROM` — start with `Bisque Golf Warranty Claims <onboarding@resend.dev>` until
     your sending domain is verified.
   - `INTERNAL_NOTIFY_EMAIL` — where in-house and flagged-claim alerts go.
   - `OPS_USERNAME` / `OPS_PASSWORD` — protects `/ops.html` and its API.
4. Deploy. Railway runs `npm install` then `node src/index.js`
   automatically (see `railway.json`). The app creates its own tables and
   seeds the brand directory on first boot — no separate migration step.
5. Back in the Dev Dashboard app's settings, set **App URL** to `APP_URL`
   and add `APP_URL/auth/shopify/callback` to **Allowed redirection
   URL(s)** — then release that version.
6. As the store owner, visit
   `https://<your-app>.up.railway.app/auth/shopify?shop=your-store.myshopify.com`
   once, approve the scopes, and the app stores its own access token in
   Postgres. Order lookup is live from that point on — no token to copy
   anywhere.
7. Visit `https://<your-app>.up.railway.app/` for the customer form, and
   `/ops.html` for the internal dashboard (you'll get a browser login
   prompt for the ops username/password).

## Updating the brand directory

The brand list (name, units sold, contact) lives in the `brands` table,
seeded once from `src/migrate.js`. Update contacts either by editing that
seed file and redeploying, or directly in Postgres via `railway connect
postgres`. There's no live ShopifyQL query wired in for "most sold" — it's a
snapshot; refresh it periodically (or wire up a scheduled job) rather than
querying analytics on every page load.

## Local development

```
cp .env.example .env   # fill in real values, or leave Shopify/Resend blank —
                        # order lookup and email sending log a warning and no-op
npm install
npm start
```
