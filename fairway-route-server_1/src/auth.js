const crypto = require("crypto");

// Guards the internal ops dashboard and its API routes with HTTP Basic Auth.
// Set OPS_USERNAME / OPS_PASSWORD in Railway's Variables tab before going
// live — without them, this middleware locks the ops routes out entirely
// rather than leaving them open.
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireOpsAuth(req, res, next) {
  const user = process.env.OPS_USERNAME;
  const pass = process.env.OPS_PASSWORD;

  if (!user || !pass) {
    return res.status(503).json({
      error: "Ops access is not configured. Set OPS_USERNAME and OPS_PASSWORD in Railway.",
    });
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    const reqUser = decoded.slice(0, sep);
    const reqPass = decoded.slice(sep + 1);
    if (timingSafeEqual(reqUser, user) && timingSafeEqual(reqPass, pass)) {
      return next();
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="Fairway Route ops"');
  return res.status(401).send("Authentication required.");
}

module.exports = { requireOpsAuth };
