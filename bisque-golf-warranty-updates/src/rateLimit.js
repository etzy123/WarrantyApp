// Minimal in-memory rate limiter — no extra dependency needed for a
// single-instance app. Keyed by IP, resets on a rolling window. Good enough
// to blunt automated order/email enumeration; not meant to survive multiple
// app instances (fine for this project's scale).
function rateLimit({ windowMs, max }) {
  const hits = new Map(); // ip -> { count, resetAt }

  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
      if (entry.resetAt < now) hits.delete(ip);
    }
  }, windowMs).unref();

  return function (req, res, next) {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let entry = hits.get(ip);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: "Too many attempts — please wait a few minutes and try again." });
    }
    next();
  };
}

module.exports = { rateLimit };
