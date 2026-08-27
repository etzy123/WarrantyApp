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

// Last-resort net: any error passed via next(err) — including from
// asyncHandler-wrapped routes — lands here instead of crashing the process
// or hanging the request.
app.use((err, req, res, next) => {
  console.error("[unhandled route error]", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Something went wrong on our end. Please try again." });
});

// Defense in depth: Node 22 crashes the whole process on an unhandled
// rejection by default. asyncHandler should catch everything reachable from
// a request, but this stops anything that slips through (e.g. a rejection
// in code not wired through Express, like a stray setTimeout/setInterval
// callback) from taking the app down.
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

async function start() {
  try {
    await migrate();
  } catch (err) {
    console.error("[startup] migration failed — check DATABASE_URL:", err.message);
  }
  app.listen(PORT, () => {
    console.log(`Bisque Golf Warranty Claims listening on port ${PORT}`);
  });
}

start();
