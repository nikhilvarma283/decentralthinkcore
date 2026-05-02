const session = require("../auth/session");
const logger = require("../lib/logger");

/**
 * Require a valid session token.
 * Attaches req.session = { id, wallet_address, expires_at }.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authorization header required" });
  }

  session
    .validate(token)
    .then((sess) => {
      if (!sess) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }
      req.session = sess;
      req.walletAddress = sess.wallet_address;
      next();
    })
    .catch((err) => {
      logger.error("Auth middleware error", { error: err.message });
      res.status(500).json({ error: "Internal server error" });
    });
}

/**
 * Attach session info if a token is present, but don't block unauthenticated requests.
 * Useful for routes that accept both anonymous and authenticated callers.
 */
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return next();

  session
    .validate(token)
    .then((sess) => {
      if (sess) {
        req.session = sess;
        req.walletAddress = sess.wallet_address;
      }
      next();
    })
    .catch(() => next());
}

module.exports = { requireAuth, optionalAuth };
