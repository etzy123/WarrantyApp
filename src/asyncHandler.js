// Node 22 crashes the whole process on an unhandled promise rejection.
// Express 4 doesn't forward a rejected async route handler to error
// middleware on its own, so without this wrapper a single bad request (a
// dropped DB connection, a Shopify API hiccup) takes the entire app down
// instead of just failing that one request.
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
