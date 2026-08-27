require("dotenv").config();
const express = require("express");
const path = require("path");
const { migrate } = require("./migrate");
const { requireOpsAuth } = require("./auth");
const apiRoutes = require("./routes");
const { router: shopifyAuthRoutes } = require("./shopifyAuth");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(shopifyAuthRoutes);
app.use("/api", apiRoutes);

// The ops dashboard HTML itself is gated the same way as its API — otherwise
// the page would load and just show empty tables / 401s from fetch calls.
app.get("/ops.html", requireOpsAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "ops.html"));
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/healthz", (req, res) => res.json({ ok: true }));

async function start() {
  try {
    await migrate();
  } catch (err) {
    console.error("[startup] migration failed — check DATABASE_URL:", err.message);
  }
  app.listen(PORT, () => {
    console.log(`Fairway Route listening on port ${PORT}`);
  });
}

start();
