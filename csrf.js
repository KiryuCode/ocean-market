/**
 * Synchronizer-token CSRF for Express.
 * Token lives in the session; forms send it as `_csrf`.
 */
const crypto = require("crypto");

function tokensEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function getCsrfToken(req) {
  if (!req.session) return "";
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  return req.session.csrfToken;
}

function readCsrfToken(req) {
  const body = req.body || {};
  return (
    body._csrf ||
    body.csrf_token ||
    req.get("x-csrf-token") ||
    req.get("csrf-token") ||
    ""
  );
}

function csrfIsValid(req) {
  const expected = req.session && req.session.csrfToken;
  return Boolean(expected) && tokensEqual(readCsrfToken(req), expected);
}

function wantsJson(req) {
  return (
    req.xhr ||
    String(req.headers.accept || "").includes("application/json") ||
    (req.body && req.body.ajax === "1")
  );
}

function rejectCsrf(req, res) {
  if (wantsJson(req)) {
    return res.status(403).json({ ok: false, error: "Invalid CSRF token" });
  }
  res.status(403);
  if (req.accepts("html")) {
    return res
      .type("html")
      .send(
        "<!doctype html><meta charset=utf-8><title>Forbidden</title>" +
          "<p>This form expired or was invalid. Go back and try again.</p>"
      );
  }
  return res.type("text").send("Invalid CSRF token\n");
}

function isMultipart(req) {
  return String(req.headers["content-type"] || "")
    .toLowerCase()
    .includes("multipart/form-data");
}

function isMultipartUploadPath(path) {
  return (
    path === "/admin/products" || /^\/admin\/products\/[^/]+\/photo$/.test(path)
  );
}

function csrfProtect(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  if (req.path === "/healthz") {
    return next();
  }
  // Multipart bodies are not parsed yet; those routes verify after multer.
  if (isMultipart(req)) {
    if (!isMultipartUploadPath(req.path)) {
      return rejectCsrf(req, res);
    }
    return next();
  }
  if (!csrfIsValid(req)) {
    return rejectCsrf(req, res);
  }
  return next();
}

function verifyParsedCsrf(req, res) {
  if (csrfIsValid(req)) return true;
  rejectCsrf(req, res);
  return false;
}

module.exports = {
  getCsrfToken,
  csrfProtect,
  verifyParsedCsrf,
};
