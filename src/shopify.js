// Live Shopify order lookup. Needs its own credentials (separate from any
// Claude/Shopify chat connection). Normal path: complete the one-time OAuth
// install at /auth/shopify?shop=your-store.myshopify.com (see
// shopifyAuth.js) — the resulting token is stored in Postgres automatically.
// SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN env vars are only a
// manual override for local testing without going through OAuth.
const { getStoredCredentials } = require("./shopifyAuth");

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

async function resolveCredentials() {
  if (process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    return { shop: process.env.SHOPIFY_STORE_DOMAIN, token: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN };
  }
  const stored = await getStoredCredentials();
  if (stored) return { shop: stored.shop_domain, token: stored.access_token };
  return null;
}

const ORDER_QUERY = `
  query OrderLookup($query: String!) {
    orders(first: 1, query: $query) {
      edges {
        node {
          id
          name
          createdAt
          customer { firstName lastName email }
          lineItems(first: 25) {
            edges {
              node {
                title
                quantity
                sku
                vendor
                image { url }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
      }
    }
  }
`;

async function findOrderByNumber(rawNumber) {
  const creds = await resolveCredentials();
  if (!creds) {
    throw new Error(
      "Shopify isn't connected yet — visit /auth/shopify?shop=your-store.myshopify.com " +
        "(as the store owner) to install the app and finish the connection."
    );
  }

  const cleaned = String(rawNumber).trim().replace(/^#/, "");
  if (!cleaned) return null;

  // Shopify order search matches the visible order name, e.g. name:36116
  const res = await fetch(
    `https://${creds.shop}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": creds.token,
      },
      body: JSON.stringify({
        query: ORDER_QUERY,
        variables: { query: `name:${cleaned}` },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error (${res.status}): ${text}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Shopify API error: ${JSON.stringify(json.errors)}`);
  }

  const edge = json.data.orders.edges[0];
  if (!edge) return null;

  const node = edge.node;
  return {
    id: node.id,
    name: node.name,
    orderDate: node.createdAt,
    customerName: node.customer
      ? [node.customer.firstName, node.customer.lastName].filter(Boolean).join(" ")
      : null,
    customerEmail: node.customer ? node.customer.email : null,
    items: node.lineItems.edges.map((e) => ({
      title: e.node.title,
      quantity: e.node.quantity,
      sku: e.node.sku,
      vendor: e.node.vendor || null,
      image: e.node.image ? e.node.image.url : null,
      unitPrice: e.node.originalUnitPriceSet ? e.node.originalUnitPriceSet.shopMoney.amount : null,
      currency: e.node.originalUnitPriceSet ? e.node.originalUnitPriceSet.shopMoney.currencyCode : null,
    })),
  };
}

module.exports = { findOrderByNumber };
