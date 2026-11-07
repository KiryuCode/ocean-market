/**
 * MySQL helpers for orders, products, and per-IP rate limiting.
 *
 * Tables:
 *   - products:         catalog (editable from admin, with photo uploads)
 *   - orders:           order_id (integer, shown as 0001), product ordered, email, timestamp,
 *                       status, tracking, and stock_reserved (1 = checkout already held stock)
 *   - ip_order_counts:  ip_address, order_count  (lifetime cap, separate from windowed throttles)
 *   - sessions:         server-side session records (cookie holds only the id)
 *   - checkout_tokens:  single-use confirm-form keys
 *   - abuse_events:     per-IP and per-email windows for order create and order mail
 *   - rate_limit_locks: rows locked so a limit check and its insert cannot race
 *   - mail_outbox:      one confirmation per order, retried until sent or given up
 *
 * Connection settings come from .env (MYSQL_*). Create the database first with:
 *   mysql -u root -p < scripts/init-ocean.sql
 */

const crypto = require("crypto");
const mysql = require("mysql2/promise");

const {
  MAX_ORDERS_PER_IP,
  DEFAULT_PRODUCTS,
  getAbuseLimits,
  getMysqlConfig,
} = require("./config");

/** Display width for order IDs (1 → "0001") */
const ORDER_ID_PAD = 4;

/** Default stock when not specified */
const DEFAULT_QTY = 25;

/** @type {import("mysql2/promise").Pool | null} */
let pool = null;

/** True after initDb has created the schema for this process. */
let dbReady = false;

function formatOrderId(orderId) {
  const n = Number(orderId);
  if (!Number.isFinite(n) || n < 0) return String(orderId);
  return String(n).padStart(ORDER_ID_PAD, "0");
}

function mapProduct(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    description: row.description || "",
    image: row.image,
    qtyAvailable: Number(
      row.qty_available !== undefined && row.qty_available !== null
        ? row.qty_available
        : DEFAULT_QTY
    ),
    category: row.category || "Shop",
  };
}

function getPool() {
  if (!pool) {
    if (process.env.SQLITE_FILE) {
      throw new Error("SQLite pool is not ready. initDb() must run first.");
    }
    const cfg = getMysqlConfig();
    const poolOptions = {
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      waitForConnections: true,
      connectionLimit: 10,
      // Fail fast when MySQL is still starting after reboot (app retries)
      connectTimeout: 10000,
      namedPlaceholders: false,
      // Return DECIMAL/BIGINT as numbers where safe
      decimalNumbers: true,
    };
    // Secure mode: encrypt the MySQL connection with TLS when MYSQL_SSL=true
    if (cfg.ssl) {
      poolOptions.ssl = cfg.ssl;
    }
    pool = mysql.createPool(poolOptions);
  }
  return pool;
}

/**
 * Create tables if missing and seed default products when the catalog is empty.
 * Call once at process start (await before listening).
 */
async function initDb() {
  if (process.env.SQLITE_FILE && !(pool && pool.__sqlite)) {
    const { createSqlitePool } = require("./sqlite-pool");
    pool = await createSqlitePool(process.env.SQLITE_FILE);
  }
  const p = getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS products (
      id            VARCHAR(64)  NOT NULL,
      name          VARCHAR(255) NOT NULL,
      price         DECIMAL(10, 2) NOT NULL,
      description   TEXT         NOT NULL,
      image         VARCHAR(1024) NOT NULL,
      qty_available INT          NOT NULL DEFAULT 25,
      sort_order    INT          NOT NULL DEFAULT 0,
      created_at    VARCHAR(64)  NOT NULL,
      category      VARCHAR(64)  NOT NULL DEFAULT 'Shop',
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureColumn(p, "products", "category", "VARCHAR(64) NOT NULL DEFAULT 'Shop'");

  await p.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id INT NOT NULL AUTO_INCREMENT,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL DEFAULT '',
      created_at VARCHAR(64) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY customers_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS orders (
      order_id         INT          NOT NULL AUTO_INCREMENT,
      product_id       TEXT         NOT NULL,
      product_name     TEXT         NOT NULL,
      email            VARCHAR(255) NULL,
      phone            VARCHAR(64)  NULL,
      ip_address       VARCHAR(64)  NOT NULL,
      created_at       VARCHAR(64)  NOT NULL,
      status           VARCHAR(32)  NOT NULL DEFAULT 'unshipped',
      tracking_number  VARCHAR(128) NULL,
      carrier          VARCHAR(64)  NULL,
      shipped_at       VARCHAR(64)  NULL,
      stock_reserved   TINYINT      NOT NULL DEFAULT 0,
      PRIMARY KEY (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Existing databases keep their rows; add shipping columns only when missing.
  await ensureColumn(
    p,
    "orders",
    "status",
    "VARCHAR(32) NOT NULL DEFAULT 'unshipped'"
  );
  await ensureColumn(p, "orders", "tracking_number", "VARCHAR(128) NULL");
  await ensureColumn(p, "orders", "carrier", "VARCHAR(64) NULL");
  await ensureColumn(p, "orders", "shipped_at", "VARCHAR(64) NULL");
  // 0 = legacy order, stock is still taken at ship. 1 = checkout already took it.
  // Default 0 so existing rows keep today's ship behavior. No order rows are rewritten.
  await ensureColumn(p, "orders", "stock_reserved", "TINYINT NOT NULL DEFAULT 0");

  await p.query(`
    CREATE TABLE IF NOT EXISTS ip_order_counts (
      ip_address  VARCHAR(64) NOT NULL,
      order_count INT         NOT NULL DEFAULT 0,
      PRIMARY KEY (ip_address)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id  VARCHAR(128) NOT NULL,
      data        TEXT         NOT NULL,
      expires_at  VARCHAR(32)  NOT NULL,
      PRIMARY KEY (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS checkout_tokens (
      token        VARCHAR(64)  NOT NULL,
      session_id   VARCHAR(128) NOT NULL,
      intent       TEXT         NOT NULL,
      created_at   VARCHAR(64)  NOT NULL,
      order_id     INT          NULL,
      consumed_at  VARCHAR(64)  NULL,
      PRIMARY KEY (token)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS abuse_events (
      id          INT          NOT NULL AUTO_INCREMENT,
      action      VARCHAR(32)  NOT NULL,
      ip_address  VARCHAR(64)  NOT NULL,
      email       VARCHAR(255) NULL,
      created_at  VARCHAR(32)  NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS rate_limit_locks (
      lock_key VARCHAR(320) NOT NULL,
      PRIMARY KEY (lock_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS mail_outbox (
      id              INT          NOT NULL AUTO_INCREMENT,
      order_id        INT          NOT NULL,
      status          VARCHAR(16)  NOT NULL,
      attempts        INT          NOT NULL DEFAULT 0,
      next_attempt_at VARCHAR(32)  NOT NULL,
      claimed_at      VARCHAR(32)  NULL,
      claim_token     VARCHAR(64)  NULL,
      last_error      VARCHAR(500) NULL,
      message_id      VARCHAR(255) NULL,
      sent_at         VARCHAR(64)  NULL,
      created_at      VARCHAR(64)  NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY mail_outbox_order (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Seed default catalog once
  const [countRows] = await p.query(
    "SELECT COUNT(*) AS n FROM products"
  );
  const count = Number(countRows[0].n);
  if (count === 0) {
    const now = new Date().toISOString();
    const conn = await p.getConnection();
    try {
      await conn.beginTransaction();
      for (let index = 0; index < DEFAULT_PRODUCTS.length; index += 1) {
        const product = DEFAULT_PRODUCTS[index];
        await conn.execute(
          `INSERT INTO products
             (id, name, price, description, image, qty_available, sort_order, created_at, category)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            product.id,
            product.name,
            product.price,
            product.description || "",
            product.image,
            Number.isFinite(product.qtyAvailable)
              ? product.qtyAvailable
              : DEFAULT_QTY,
            index,
            now,
            product.category || "Shop",
          ]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  dbReady = true;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

async function ensureColumn(pool, table, column, definition) {
  if (pool && pool.__sqlite) {
    const [rows] = await pool.query(`PRAGMA table_info(${table})`);
    const exists = rows.some((row) => String(row.name) === String(column));
    if (!exists) {
      await pool.query(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
      );
    }
    return;
  }
  const [rows] = await pool.query(
    `SELECT 1 AS ok
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [table, column]
  );
  if (!rows.length) {
    await pool.query(
      "ALTER TABLE `" + table + "` ADD COLUMN `" + column + "` " + definition
    );
  }
}

async function listProducts() {
  const [rows] = await getPool().query(
    "SELECT * FROM products ORDER BY sort_order ASC, name ASC"
  );
  return rows.map(mapProduct);
}

async function getProduct(productId) {
  const [rows] = await getPool().execute(
    "SELECT * FROM products WHERE id = ?",
    [productId]
  );
  return mapProduct(rows[0]);
}

async function productIdExists(productId) {
  const [rows] = await getPool().execute(
    "SELECT 1 AS ok FROM products WHERE id = ? LIMIT 1",
    [productId]
  );
  return rows.length > 0;
}

/**
 * Create a product. Throws if id already exists.
 * Returns the created product.
 */
async function createProduct({
  id,
  name,
  price,
  description,
  image,
  qtyAvailable,
  category,
}) {
  const [sortRows] = await getPool().query(
    "SELECT COALESCE(MAX(sort_order), -1) AS m FROM products"
  );
  const maxSort = sortRows[0].m;
  const createdAt = new Date().toISOString();
  const qty = Math.max(0, Math.floor(Number(qtyAvailable) || 0));

  await getPool().execute(
    `INSERT INTO products
       (id, name, price, description, image, qty_available, sort_order, created_at, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      name,
      Number(price),
      description || "",
      image,
      qty,
      Number(maxSort) + 1,
      createdAt,
      category || "Shop",
    ]
  );

  return getProduct(id);
}

async function updateProductImage(productId, imagePath) {
  const [result] = await getPool().execute(
    "UPDATE products SET image = ? WHERE id = ?",
    [imagePath, productId]
  );
  return result.affectedRows > 0;
}

/**
 * Update price and/or available quantity for a product.
 * Returns true if a row was updated.
 *
 * When qtyBaseline is sent (the qty the admin form loaded), the save applies
 * the difference under a row lock. A checkout that reserved a unit between
 * the page load and the save is not overwritten.
 * Without a baseline, qtyAvailable is an absolute set (catalog tools and tests).
 */
async function updateProductPricing(productId, { price, qtyAvailable, qtyBaseline }) {
  const conn = await getPool().getConnection();
  let finished = false;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      "SELECT price, qty_available FROM products WHERE id = ? FOR UPDATE",
      [productId]
    );
    if (!rows[0]) {
      await conn.rollback();
      finished = true;
      return false;
    }

    const currentPrice = Number(rows[0].price);
    const currentQty = Number(rows[0].qty_available);
    const nextPrice =
      price !== undefined && price !== null && price !== ""
        ? Number(price)
        : currentPrice;
    const hasQty =
      qtyAvailable !== undefined && qtyAvailable !== null && qtyAvailable !== "";
    const hasBaseline =
      qtyBaseline !== undefined && qtyBaseline !== null && qtyBaseline !== "";

    let nextQty = Number.isFinite(currentQty) ? currentQty : 0;
    if (hasBaseline && hasQty) {
      const baseline = Math.floor(Number(qtyBaseline));
      const desired = Math.floor(Number(qtyAvailable));
      if (!Number.isFinite(baseline) || !Number.isFinite(desired) || desired < 0) {
        throw new Error("Enter a valid quantity.");
      }
      nextQty = nextQty + (desired - baseline);
      if (!Number.isFinite(nextQty) || nextQty < 0) {
        throw orderError(
          "Quantity changed while you were editing. Reload the page and save again.",
          "CONFLICT"
        );
      }
    } else if (hasQty) {
      nextQty = Math.max(0, Math.floor(Number(qtyAvailable)));
    }

    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      throw new Error("Enter a valid price.");
    }
    if (!Number.isFinite(nextQty) || nextQty < 0) {
      throw new Error("Enter a valid quantity.");
    }

    const [result] = await conn.execute(
      "UPDATE products SET price = ?, qty_available = ? WHERE id = ?",
      [nextPrice, nextQty, productId]
    );
    await conn.commit();
    finished = true;
    return result.affectedRows > 0;
  } catch (err) {
    if (!finished) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        console.error("Pricing rollback failed:", rollbackErr);
      }
    }
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Orders / IP limits
// ---------------------------------------------------------------------------

async function getIpOrderCount(ipAddress) {
  const [rows] = await getPool().execute(
    "SELECT order_count FROM ip_order_counts WHERE ip_address = ?",
    [ipAddress]
  );
  return rows[0] ? Number(rows[0].order_count) : 0;
}

async function canPlaceOrder(ipAddress) {
  return (await getIpOrderCount(ipAddress)) < MAX_ORDERS_PER_IP;
}

function orderError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function orderTimestamp() {
  return new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

function normalizeLimitEmail(email) {
  const clean = String(email || "").trim().toLowerCase();
  return clean || null;
}

function mergeIntentLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw orderError(
      "This checkout form is invalid or expired. Go back and try again.",
      "INVALID_CHECKOUT"
    );
  }
  const map = new Map();
  for (const line of lines) {
    const productId = String((line && line.productId) || "").trim();
    const quantity = Math.floor(Number(line && line.quantity));
    if (!productId || !Number.isFinite(quantity) || quantity < 1) {
      throw orderError(
        "This checkout form is invalid or expired. Go back and try again.",
        "INVALID_CHECKOUT"
      );
    }
    map.set(productId, (map.get(productId) || 0) + quantity);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([productId, quantity]) => ({ productId, quantity }));
}

function parseIntent(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || ""));
  } catch {
    throw orderError(
      "This checkout form is invalid or expired. Go back and try again.",
      "INVALID_CHECKOUT"
    );
  }
  const mode = parsed && parsed.mode === "cart" ? "cart" : "buy_now";
  const lines = mergeIntentLines(parsed && parsed.lines);
  return { mode, lines };
}

function tokenIsFresh(row) {
  const created = Date.parse(row && row.created_at);
  if (!Number.isFinite(created)) return false;
  return Date.now() - created <= getAbuseLimits().checkoutTtlMs;
}

/**
 * One-time key for the confirm form. Stored in the database and bound to
 * the server session, so a copied POST body cannot be spent twice.
 */
async function issueCheckoutToken({ sessionId, intent }) {
  const sid = String(sessionId || "").trim();
  if (!sid) {
    throw orderError(
      "This checkout form is invalid or expired. Go back and try again.",
      "INVALID_CHECKOUT"
    );
  }
  const lines = mergeIntentLines(intent && intent.lines);
  const mode = intent && intent.mode === "cart" ? "cart" : "buy_now";
  const token = crypto.randomBytes(32).toString("hex");
  try {
    await cleanupRetention();
    await trimUnusedCheckoutTokens(sid);
  } catch (err) {
    console.error("Checkout token cleanup failed:", err);
  }
  await getPool().execute(
    `INSERT INTO checkout_tokens (token, session_id, intent, created_at)
     VALUES (?, ?, ?, ?)`,
    [token, sid, JSON.stringify({ mode, lines }), new Date().toISOString()]
  );
  return token;
}

async function trimUnusedCheckoutTokens(sessionId) {
  const cap = getAbuseLimits().unusedTokenCap;
  const [rows] = await getPool().execute(
    `SELECT token FROM checkout_tokens
      WHERE session_id = ? AND order_id IS NULL
      ORDER BY created_at ASC, token ASC`,
    [sessionId]
  );
  const excess = rows.length - (cap - 1);
  if (excess <= 0) return 0;
  let removed = 0;
  for (const row of rows.slice(0, excess)) {
    const [result] = await getPool().execute(
      "DELETE FROM checkout_tokens WHERE token = ? AND order_id IS NULL",
      [row.token]
    );
    removed += result.affectedRows || 0;
  }
  return removed;
}

/**
 * Drop expired unused checkout forms, old consumed tokens, and abuse rows
 * past the retention window. Bounded so one call cannot scan forever.
 * Does not update orders.
 */
async function cleanupRetention(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const limits = getAbuseLimits();
  const batch = 500;
  let removed = 0;

  const [oldAbuse] = await getPool().execute(
    `SELECT id FROM abuse_events
      WHERE created_at < ?
      ORDER BY id ASC
      LIMIT ${batch}`,
    [String(now - limits.retentionMs)]
  );
  for (const row of oldAbuse) {
    const [result] = await getPool().execute(
      "DELETE FROM abuse_events WHERE id = ?",
      [row.id]
    );
    removed += result.affectedRows || 0;
  }

  const unusedCutoff = new Date(now - limits.checkoutTtlMs).toISOString();
  const [staleTokens] = await getPool().execute(
    `SELECT token FROM checkout_tokens
      WHERE order_id IS NULL AND created_at < ?
      LIMIT ${batch}`,
    [unusedCutoff]
  );
  for (const row of staleTokens) {
    const [result] = await getPool().execute(
      "DELETE FROM checkout_tokens WHERE token = ? AND order_id IS NULL",
      [row.token]
    );
    removed += result.affectedRows || 0;
  }

  const consumedCutoff = new Date(now - limits.retentionMs).toISOString();
  const [oldConsumed] = await getPool().execute(
    `SELECT token FROM checkout_tokens
      WHERE order_id IS NOT NULL
        AND consumed_at IS NOT NULL
        AND consumed_at < ?
      LIMIT ${batch}`,
    [consumedCutoff]
  );
  for (const row of oldConsumed) {
    const [result] = await getPool().execute(
      "DELETE FROM checkout_tokens WHERE token = ? AND order_id IS NOT NULL",
      [row.token]
    );
    removed += result.affectedRows || 0;
  }
  return removed;
}

async function countUnusedCheckoutTokens(sessionId) {
  const [rows] = await getPool().execute(
    `SELECT COUNT(*) AS n FROM checkout_tokens
      WHERE session_id = ? AND order_id IS NULL`,
    [String(sessionId || "")]
  );
  return Number(rows[0] ? rows[0].n : 0);
}

async function setCheckoutTokenCreatedAt(token, createdAt) {
  await getPool().execute(
    "UPDATE checkout_tokens SET created_at = ? WHERE token = ?",
    [createdAt, token]
  );
}

async function insertAbuseEvent({ action, ipAddress, email, createdAt }) {
  await getPool().execute(
    `INSERT INTO abuse_events (action, ip_address, email, created_at)
     VALUES (?, ?, ?, ?)`,
    [
      action,
      ipAddress,
      email || null,
      createdAt !== undefined && createdAt !== null
        ? String(createdAt)
        : String(Date.now()),
    ]
  );
}

async function countAbuseEvents({ action, ipAddress, email } = {}) {
  const clauses = [];
  const params = [];
  if (action) {
    clauses.push("action = ?");
    params.push(action);
  }
  if (ipAddress) {
    clauses.push("ip_address = ?");
    params.push(ipAddress);
  }
  if (email) {
    clauses.push("email = ?");
    params.push(email);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows] = await getPool().execute(
    `SELECT COUNT(*) AS n FROM abuse_events ${where}`,
    params
  );
  return Number(rows[0] ? rows[0].n : 0);
}

async function describeCheckout(token, sessionId) {
  const [rows] = await getPool().execute(
    "SELECT session_id, intent FROM checkout_tokens WHERE token = ? LIMIT 1",
    [String(token || "")]
  );
  const row = rows[0];
  if (!row || row.session_id !== sessionId) return null;
  let intent;
  try {
    intent = parseIntent(row.intent);
  } catch {
    return null;
  }
  const items = [];
  for (const line of intent.lines) {
    const product = await getProduct(line.productId);
    if (!product) continue;
    items.push({
      product,
      quantity: line.quantity,
      lineTotal: product.price * line.quantity,
    });
  }
  return { mode: intent.mode, items };
}

async function countAbuse(conn, action, column, value, since) {
  const sql =
    column === "email"
      ? `SELECT COUNT(*) AS n FROM abuse_events
          WHERE action = ? AND email = ? AND created_at >= ?`
      : `SELECT COUNT(*) AS n FROM abuse_events
          WHERE action = ? AND ip_address = ? AND created_at >= ?`;
  const [rows] = await conn.execute(sql, [action, value, String(since)]);
  return Number(rows[0] ? rows[0].n : 0);
}

async function recordAbuse(conn, action, ipAddress, email) {
  await conn.execute(
    `INSERT INTO abuse_events (action, ip_address, email, created_at)
     VALUES (?, ?, ?, ?)`,
    [action, ipAddress, email, String(Date.now())]
  );
}

async function assertUnderLimit(conn, action, ipAddress, email, limits) {
  const windowMs = action === "order_mail" ? limits.mailWindowMs : limits.orderWindowMs;
  const ipLimit = action === "order_mail" ? limits.mailIp : limits.orderIp;
  const emailLimit = action === "order_mail" ? limits.mailEmail : limits.orderEmail;
  const since = Date.now() - windowMs;
  if (ipLimit > 0) {
    const n = await countAbuse(conn, action, "ip_address", ipAddress, since);
    if (n >= ipLimit) return false;
  }
  if (email && emailLimit > 0) {
    const n = await countAbuse(conn, action, "email", email, since);
    if (n >= emailLimit) return false;
  }
  return true;
}

function isDuplicateKey(err) {
  const code = err && err.code;
  const message = String((err && err.message) || "");
  return (
    code === "ER_DUP_ENTRY" ||
    code === "SQLITE_CONSTRAINT" ||
    /UNIQUE constraint failed/i.test(message) ||
    /Duplicate entry/i.test(message)
  );
}

function isLockConflict(err) {
  const code = err && (err.code !== undefined ? err.code : err.errno);
  const errno = err && err.errno;
  return (
    code === "ER_LOCK_DEADLOCK" ||
    code === "ER_LOCK_WAIT_TIMEOUT" ||
    code === 1213 ||
    code === 1205 ||
    errno === 1213 ||
    errno === 1205
  );
}

/**
 * Lock one rate-limit bucket for the rest of this transaction.
 *
 * SELECT FOR UPDATE on a missing key takes a gap lock. Two transactions
 * can both hold that gap lock, then deadlock when they INSERT. Upsert the
 * row first (exclusive lock on a real record), then lock it. Callers must
 * pass keys in one sorted order.
 */
async function lockBucket(conn, key) {
  if (getPool().__sqlite) {
    await conn.execute(
      `INSERT INTO rate_limit_locks (lock_key) VALUES (?)
       ON CONFLICT(lock_key) DO UPDATE SET lock_key = excluded.lock_key`,
      [key]
    );
  } else {
    await conn.execute(
      `INSERT INTO rate_limit_locks (lock_key) VALUES (?)
       ON DUPLICATE KEY UPDATE lock_key = lock_key`,
      [key]
    );
  }
  await conn.execute(
    "SELECT lock_key FROM rate_limit_locks WHERE lock_key = ? FOR UPDATE",
    [key]
  );
}

function rateLockKeys(ip, email) {
  const keys = [
    `order_create:ip:${ip}`,
    `order_mail:ip:${ip}`,
    `order_fail:ip:${ip}`,
  ];
  if (email) {
    keys.push(
      `order_create:email:${email}`,
      `order_mail:email:${email}`,
      `order_fail:email:${email}`
    );
  }
  keys.sort();
  return keys;
}

async function lockRateBuckets(conn, ip, email) {
  for (const key of rateLockKeys(ip, email)) {
    await lockBucket(conn, key);
  }
}

/**
 * Store a failed checkout attempt, but stop once the cap for this window
 * is reached so retries cannot grow the table without bound.
 */
async function recordFailureBounded(conn, ip, email) {
  const limits = getAbuseLimits();
  if (!limits.failLimit) return false;
  const since = Date.now() - limits.orderWindowMs;
  const ipCount = await countAbuse(conn, "order_fail", "ip_address", ip, since);
  if (ipCount >= limits.failLimit) return false;
  if (email) {
    const emailCount = await countAbuse(conn, "order_fail", "email", email, since);
    if (emailCount >= limits.failLimit) return false;
  }
  await recordAbuse(conn, "order_fail", ip, email);
  return true;
}

/**
 * Quantity already promised by unshipped orders that did not hold stock
 * at checkout (stock_reserved = 0). Those rows are not modified here.
 */
async function unreservedUnshippedQty(conn, productId) {
  const [rows] = await conn.execute(
    `SELECT product_id, product_name FROM orders
      WHERE (stock_reserved IS NULL OR stock_reserved = 0)
        AND (status IS NULL OR LOWER(status) <> 'shipped')
        AND (shipped_at IS NULL OR TRIM(shipped_at) = '')`
  );
  let total = 0;
  for (const row of rows) {
    for (const token of parseOrderItemTokens(row)) {
      if (token.productId === productId) total += token.quantity;
    }
  }
  return total;
}

/**
 * Hold stock for one product. Conditional update is the race backstop:
 * qty_available must cover this order plus legacy unshipped demand.
 */
async function holdProductStock(conn, productId, quantity) {
  const [rows] = await conn.execute(
    "SELECT id, name, qty_available FROM products WHERE id = ? FOR UPDATE",
    [productId]
  );
  if (!rows[0]) {
    throw orderError("That product is no longer available.", "OUT_OF_STOCK");
  }
  const name = rows[0].name;
  const onHand = Number(rows[0].qty_available);
  const available = Number.isFinite(onHand) ? onHand : 0;
  const unreserved = await unreservedUnshippedQty(conn, productId);
  const need = quantity + unreserved;
  if (quantity < 1 || available <= 0 || available < need) {
    const message =
      available <= 0 || available - unreserved <= 0
        ? `${name} is out of stock.`
        : `${name} does not have enough stock for this order.`;
    throw orderError(message, "OUT_OF_STOCK");
  }
  const [result] = await conn.execute(
    `UPDATE products
        SET qty_available = qty_available - ?
      WHERE id = ?
        AND qty_available >= ?`,
    [quantity, productId, need]
  );
  if (!result.affectedRows) {
    throw orderError(`${name} is out of stock.`, "OUT_OF_STOCK");
  }
  return name;
}

/**
 * Create one order from a checkout token.
 *
 * Stock is decremented here (stock_reserved = 1). shipOrder must not
 * decrement these rows again. Orders placed before this change stay at
 * stock_reserved 0 and still decrement when they ship.
 *
 * A token that already has an order is a replay: same id, no stock change,
 * no mail permit.
 */
async function placeCheckoutOrder(input) {
  const retries = readPositive("CHECKOUT_LOCK_RETRIES", 5);
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await placeCheckoutOrderOnce(input);
    } catch (err) {
      lastErr = err;
      if (!isLockConflict(err) || attempt === retries) throw err;
      const waitMs = 8 * attempt + Math.floor(Math.random() * 30);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastErr;
}

async function placeCheckoutOrderOnce({
  token,
  sessionId,
  email,
  phone,
  ipAddress,
  postedMode,
  postedProductId,
}) {
  const limits = getAbuseLimits();
  const cleanEmail = String(email || "").trim() || null;
  const limitEmail = normalizeLimitEmail(cleanEmail);
  const cleanPhone = String(phone || "").trim() || null;
  const ip = String(ipAddress || "unknown");
  const conn = await getPool().getConnection();
  let finished = false;

  async function finishRollback() {
    if (finished) return;
    finished = true;
    try {
      await conn.rollback();
    } catch (err) {
      console.error("Checkout rollback failed:", err);
    }
  }

  try {
    await conn.beginTransaction();

    const [tokenRows] = await conn.execute(
      "SELECT token, session_id, intent, order_id, created_at FROM checkout_tokens WHERE token = ? FOR UPDATE",
      [String(token || "")]
    );
    const tokenRow = tokenRows[0];
    if (!tokenRow || tokenRow.session_id !== sessionId) {
      await finishRollback();
      throw orderError(
        "This checkout form is invalid or expired. Go back and try again.",
        "INVALID_CHECKOUT"
      );
    }

    const intent = parseIntent(tokenRow.intent);
    if (tokenRow.order_id) {
      await finishRollback();
      return {
        replay: true,
        orderId: formatOrderId(tokenRow.order_id),
        mode: intent.mode,
        lines: intent.lines,
        mailPermitted: false,
      };
    }
    if (!tokenIsFresh(tokenRow)) {
      await finishRollback();
      throw orderError(
        "This checkout form is invalid or expired. Go back and try again.",
        "INVALID_CHECKOUT"
      );
    }
    if (postedMode && postedMode !== intent.mode) {
      await finishRollback();
      throw orderError(
        "This checkout form is invalid or expired. Go back and try again.",
        "INVALID_CHECKOUT"
      );
    }
    if (
      intent.mode === "buy_now" &&
      postedProductId &&
      postedProductId !== intent.lines[0].productId
    ) {
      await finishRollback();
      throw orderError(
        "This checkout form is invalid or expired. Go back and try again.",
        "INVALID_CHECKOUT"
      );
    }

    // Hold the IP and email buckets before the count and until commit.
    // The success row is inserted later in this same transaction, still
    // under those locks, so a burst cannot pass the cap.
    await lockRateBuckets(conn, ip, limitEmail);
    const allowed = await assertUnderLimit(
      conn,
      "order_create",
      ip,
      limitEmail,
      limits
    );
    if (!allowed) {
      await recordFailureBounded(conn, ip, limitEmail);
      await conn.commit();
      finished = true;
      throw orderError(
        "Too many orders from this network or email address. Wait a while and try again.",
        "RATE_LIMIT"
      );
    }

    const names = new Map();
    try {
      for (const line of intent.lines) {
        const name = await holdProductStock(conn, line.productId, line.quantity);
        names.set(line.productId, name);
      }
    } catch (err) {
      if (err && err.code === "OUT_OF_STOCK") {
        // Drop the partial hold. The failure row is capped and is not an order.
        try {
          await conn.rollback();
        } catch (rollbackErr) {
          console.error("Checkout rollback failed:", rollbackErr);
        }
        try {
          await conn.beginTransaction();
          await lockRateBuckets(conn, ip, limitEmail);
          await recordFailureBounded(conn, ip, limitEmail);
          await conn.commit();
        } catch (recordErr) {
          console.error("Abuse event record failed:", recordErr);
          try {
            await conn.rollback();
          } catch {
            /* already rolled back */
          }
        }
        finished = true;
      }
      throw err;
    }

    if (getPool().__sqlite) {
      await conn.execute(
        `INSERT INTO ip_order_counts (ip_address, order_count) VALUES (?, 0)
         ON CONFLICT(ip_address) DO UPDATE SET ip_address = excluded.ip_address`,
        [ip]
      );
    } else {
      await conn.execute(
        `INSERT INTO ip_order_counts (ip_address, order_count) VALUES (?, 0)
         ON DUPLICATE KEY UPDATE ip_address = ip_address`,
        [ip]
      );
    }
    const [ipRows] = await conn.execute(
      "SELECT order_count FROM ip_order_counts WHERE ip_address = ? FOR UPDATE",
      [ip]
    );
    const current = ipRows[0] ? Number(ipRows[0].order_count) : 0;
    if (current >= MAX_ORDERS_PER_IP) {
      await finishRollback();
      const err = orderError(
        `Order limit reached for this address (${MAX_ORDERS_PER_IP} orders maximum).`,
        "ORDER_LIMIT"
      );
      throw err;
    }

    const productId = intent.lines
      .map((line) => `${line.productId}×${line.quantity}`)
      .join(", ");
    const productName = intent.lines
      .map((line) => {
        const name = names.get(line.productId) || line.productId;
        return line.quantity > 1 ? `${name} ×${line.quantity}` : name;
      })
      .join(", ");
    const createdAt = orderTimestamp();

    const [insertResult] = await conn.execute(
      `INSERT INTO orders
         (product_id, product_name, email, phone, ip_address, created_at, status, stock_reserved)
       VALUES (?, ?, ?, ?, ?, ?, 'unshipped', 1)`,
      [productId, productName, cleanEmail, cleanPhone, ip, createdAt]
    );
    const orderId = formatOrderId(insertResult.insertId);

    const [consumed] = await conn.execute(
      `UPDATE checkout_tokens
          SET order_id = ?, consumed_at = ?
        WHERE token = ?
          AND session_id = ?
          AND order_id IS NULL`,
      [insertResult.insertId, new Date().toISOString(), tokenRow.token, sessionId]
    );
    if (!consumed.affectedRows) {
      await finishRollback();
      throw orderError(
        "This checkout form is invalid or expired. Go back and try again.",
        "INVALID_CHECKOUT"
      );
    }

    await conn.execute(
      "UPDATE ip_order_counts SET order_count = order_count + 1 WHERE ip_address = ?",
      [ip]
    );
    // Consume the order slot now, while the bucket locks from the check
    // are still held. A concurrent checkout blocks until this commits.
    await recordAbuse(conn, "order_create", ip, limitEmail);

    let mailQueued = false;
    const mailAllowed = await assertUnderLimit(
      conn,
      "order_mail",
      ip,
      limitEmail,
      limits
    );
    if (mailAllowed) {
      await recordAbuse(conn, "order_mail", ip, limitEmail);
      const queuedAt = String(Date.now());
      await conn.execute(
        `INSERT INTO mail_outbox
           (order_id, status, attempts, next_attempt_at, created_at)
         VALUES (?, 'pending', 0, ?, ?)`,
        [insertResult.insertId, queuedAt, new Date().toISOString()]
      );
      mailQueued = true;
    }

    await conn.commit();
    finished = true;
    return {
      replay: false,
      orderId,
      mode: intent.mode,
      lines: intent.lines,
      mailPermitted: mailQueued,
      mailQueued,
    };
  } catch (err) {
    await finishRollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Insert an order that does not hold stock. Used so ship still decrements
 * rows that were placed before checkout started reserving inventory.
 * Does not change product quantities and does not send mail.
 */
async function insertUnreservedOrder({
  productId,
  quantity,
  productName,
  email,
  phone,
  ipAddress,
}) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const id = String(productId || "").trim();
  if (!id) throw orderError("Product is required.", "VALIDATION");
  const [result] = await getPool().execute(
    `INSERT INTO orders
       (product_id, product_name, email, phone, ip_address, created_at, status, stock_reserved)
     VALUES (?, ?, ?, ?, ?, ?, 'unshipped', 0)`,
    [
      `${id}×${qty}`,
      productName || id,
      email || null,
      phone || null,
      ipAddress || "historical",
      orderTimestamp(),
    ]
  );
  return formatOrderId(result.insertId);
}

async function clearAbuseEvents() {
  await getPool().query("DELETE FROM abuse_events");
}

function mailRetrySettings() {
  const maxAttempts = readPositive("MAIL_MAX_ATTEMPTS", 5);
  const baseMs = readNonNegative("MAIL_RETRY_BASE_MS", 30000);
  const maxDelayMs = readPositive("MAIL_RETRY_MAX_MS", 15 * 60 * 1000);
  const leaseMs = readPositive("MAIL_SEND_LEASE_MS", 120000);
  const lease = leaseMs > 0 ? leaseMs : 120000;
  // SMTP must finish before the lease can expire, or a second worker can
  // steal the claim while the first send is still on the wire.
  const halfLease = Math.max(1, Math.floor(lease / 2));
  const requestedTimeout = readPositive("MAIL_SMTP_TIMEOUT_MS", halfLease);
  const smtpTimeoutMs = Math.min(requestedTimeout, halfLease);
  return {
    maxAttempts: maxAttempts > 0 ? maxAttempts : 5,
    baseMs,
    maxDelayMs: maxDelayMs > 0 ? maxDelayMs : 15 * 60 * 1000,
    leaseMs: lease,
    smtpTimeoutMs,
  };
}

function readPositive(name, fallback) {
  const n = readNonNegative(name, fallback);
  return n > 0 ? n : fallback;
}

function readNonNegative(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function mapOutbox(row) {
  if (!row) return undefined;
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    status: row.status,
    attempts: Number(row.attempts) || 0,
    nextAttemptAt: row.next_attempt_at,
    claimedAt: row.claimed_at || null,
    claimToken: row.claim_token || null,
    lastError: row.last_error || null,
    messageId: row.message_id || null,
    sentAt: row.sent_at || null,
    createdAt: row.created_at,
  };
}

async function listDueMail(limit, settings) {
  const now = String(Date.now());
  const leaseBefore = String(Date.now() - settings.leaseMs);
  const cap = Math.max(1, Math.min(50, Number(limit) || 5));
  const [rows] = await getPool().execute(
    `SELECT * FROM mail_outbox
      WHERE attempts < ?
        AND (
          (status = 'pending' AND next_attempt_at <= ?)
          OR (status = 'sending' AND (claimed_at IS NULL OR claimed_at <= ?))
        )
      ORDER BY id ASC
      LIMIT ${cap}`,
    [settings.maxAttempts, now, leaseBefore]
  );
  return rows.map(mapOutbox);
}

/**
 * Move one due row to sending. Returns null when another worker took it.
 * The claim commits before SMTP so a slow send does not hold the rate locks.
 */
async function claimMailOutbox(id, settings) {
  const now = String(Date.now());
  const leaseBefore = String(Date.now() - settings.leaseMs);
  const claimToken = crypto.randomBytes(16).toString("hex");
  const conn = await getPool().getConnection();
  let finished = false;
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `UPDATE mail_outbox
          SET status = 'sending',
              attempts = attempts + 1,
              claimed_at = ?,
              claim_token = ?
        WHERE id = ?
          AND attempts < ?
          AND (
            (status = 'pending' AND next_attempt_at <= ?)
            OR (status = 'sending' AND (claimed_at IS NULL OR claimed_at <= ?))
          )`,
      [now, claimToken, id, settings.maxAttempts, now, leaseBefore]
    );
    if (!result.affectedRows) {
      await conn.rollback();
      finished = true;
      return null;
    }
    const [rows] = await conn.execute(
      "SELECT * FROM mail_outbox WHERE id = ? AND claim_token = ?",
      [id, claimToken]
    );
    await conn.commit();
    finished = true;
    return mapOutbox(rows[0]);
  } catch (err) {
    if (!finished) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        console.error("Mail claim rollback failed:", rollbackErr);
      }
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Keep a live send's lease fresh. Returns false when this claim no longer
 * owns the row (another worker fenced it). Callers must not mark sent then.
 */
async function renewMailClaim(id, claimToken) {
  const [result] = await getPool().execute(
    `UPDATE mail_outbox
        SET claimed_at = ?
      WHERE id = ? AND claim_token = ? AND status = 'sending'`,
    [String(Date.now()), id, claimToken]
  );
  return result.affectedRows > 0;
}

async function finishMailOutbox(id, claimToken, outcome) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    if (outcome.sent) {
      await conn.execute(
        `UPDATE mail_outbox
            SET status = 'sent',
                sent_at = ?,
                message_id = ?,
                last_error = NULL
          WHERE id = ? AND claim_token = ? AND status = 'sending'`,
        [
          new Date().toISOString(),
          outcome.messageId ? String(outcome.messageId).slice(0, 255) : null,
          id,
          claimToken,
        ]
      );
    } else if (outcome.dead || outcome.terminal) {
      await conn.execute(
        `UPDATE mail_outbox
            SET status = 'dead',
                last_error = ?,
                next_attempt_at = ?
          WHERE id = ? AND claim_token = ? AND status = 'sending'`,
        [
          String(outcome.error || "not sent").slice(0, 500),
          String(Date.now()),
          id,
          claimToken,
        ]
      );
    } else {
      // requeue (missing SMTP config) gives the attempt back so the cap
      // cannot turn "not configured yet" into a permanent dead letter.
      await conn.execute(
        `UPDATE mail_outbox
            SET status = 'pending',
                attempts = CASE
                  WHEN ? = 1 AND attempts > 0 THEN attempts - 1
                  ELSE attempts
                END,
                last_error = ?,
                next_attempt_at = ?,
                claim_token = NULL,
                claimed_at = NULL
          WHERE id = ? AND claim_token = ? AND status = 'sending'`,
        [
          outcome.requeue ? 1 : 0,
          String(outcome.error || "send failed").slice(0, 500),
          String(outcome.nextAttemptAt || Date.now()),
          id,
          claimToken,
        ]
      );
    }
    await conn.commit();
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error("Mail finish rollback failed:", rollbackErr);
    }
    throw err;
  } finally {
    conn.release();
  }
}

async function getMailOutboxByOrderId(orderId) {
  const n = parseInt(String(orderId), 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  const [rows] = await getPool().execute(
    "SELECT * FROM mail_outbox WHERE order_id = ? LIMIT 1",
    [n]
  );
  return mapOutbox(rows[0]);
}

function normalizeOrderStatus(row) {
  const raw = String((row && row.status) || "")
    .trim()
    .toLowerCase();
  if (raw === "shipped") return "shipped";
  if (row && row.shipped_at && String(row.shipped_at).trim()) return "shipped";
  return "unshipped";
}

function mapOrder(row) {
  if (!row) return undefined;
  return {
    ...row,
    order_id_display: formatOrderId(row.order_id),
    status: normalizeOrderStatus(row),
    tracking_number: row.tracking_number ? String(row.tracking_number) : null,
    carrier: row.carrier ? String(row.carrier) : null,
    shipped_at: row.shipped_at ? String(row.shipped_at) : null,
  };
}

const TRACKING_MAX = 128;
const CARRIER_MAX = 64;

function shipError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Split the stored product_id / product_name strings into line tokens.
 * product_id looks like "wave-mug×1, tide-tote×2".
 */
function parseOrderItemTokens(order) {
  const idTokens = String((order && order.product_id) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const nameTokens = String((order && order.product_name) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const items = [];
  for (let index = 0; index < idTokens.length; index += 1) {
    const token = idTokens[index];
    const match = token.match(/^(.+?)(?:×|x)(\d+)$/i);
    const productId = (match ? match[1] : token).trim();
    const quantity = match ? Math.max(1, parseInt(match[2], 10) || 1) : 1;
    if (!productId) continue;
    items.push({
      productId,
      quantity,
      nameToken: nameTokens[index] || "",
    });
  }
  return items;
}

/**
 * Mark an order shipped, store tracking, and decrement product stock.
 * One transaction. Shipping an order that is already shipped is a no-op
 * (inventory is not reduced again). Stock is never taken below zero:
 * the whole shipment rolls back and an INSUFFICIENT_STOCK error is thrown.
 */
async function shipOrder({ orderId, trackingNumber, carrier }) {
  const tracking = String(trackingNumber == null ? "" : trackingNumber).trim();
  const carrierRaw = String(carrier == null ? "" : carrier).trim();

  if (!tracking) {
    throw shipError(
      "A tracking number is required. Nothing was changed.",
      "VALIDATION"
    );
  }
  if (tracking.length > TRACKING_MAX) {
    throw shipError(
      `Tracking number must be ${TRACKING_MAX} characters or fewer. Nothing was changed.`,
      "VALIDATION"
    );
  }
  if (carrierRaw.length > CARRIER_MAX) {
    throw shipError(
      `Carrier must be ${CARRIER_MAX} characters or fewer. Nothing was changed.`,
      "VALIDATION"
    );
  }

  const n = parseInt(String(orderId == null ? "" : orderId).trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    throw shipError("Select an order to ship. Nothing was changed.", "VALIDATION");
  }

  const carrierValue = carrierRaw || null;
  const conn = await getPool().getConnection();
  let started = false;

  try {
    await conn.beginTransaction();
    started = true;

    const [rows] = await conn.execute(
      "SELECT * FROM orders WHERE order_id = ? FOR UPDATE",
      [n]
    );
    const row = rows[0];
    if (!row) {
      throw shipError("That order was not found. Nothing was changed.", "NOT_FOUND");
    }

    const current = mapOrder(row);
    if (current.status === "shipped") {
      await conn.rollback();
      started = false;
      return { alreadyShipped: true, stockDecremented: false, order: current };
    }

    // Checkout holds stock and sets stock_reserved. Shipping that order
    // must not take the same units again. Older rows stay at 0 and still
    // decrement here, once.
    const alreadyHeld = Number(row.stock_reserved) === 1;

    const tokens = parseOrderItemTokens(row);
    if (!tokens.length) {
      throw shipError(
        `Order ${current.order_id_display} has no items to ship. Nothing was changed.`,
        "EMPTY"
      );
    }

    const needed = new Map();
    for (const token of tokens) {
      needed.set(token.productId, (needed.get(token.productId) || 0) + token.quantity);
    }

    if (!alreadyHeld) {
      const problems = [];
      const locked = [];
      for (const productId of [...needed.keys()].sort()) {
        const [prows] = await conn.execute(
          "SELECT id, name, qty_available FROM products WHERE id = ? FOR UPDATE",
          [productId]
        );
        const want = needed.get(productId);
        if (!prows[0]) {
          problems.push(`${productId} (qty ${want}) is not in the catalog`);
          continue;
        }
        const have = Number(prows[0].qty_available);
        const available = Number.isFinite(have) ? have : 0;
        if (available < want) {
          problems.push(
            `${prows[0].name} needs ${want} but only ${available} ${
              available === 1 ? "is" : "are"
            } available`
          );
        } else {
          locked.push({ productId, want, name: prows[0].name });
        }
      }

      if (problems.length) {
        throw shipError(
          `Cannot ship order ${current.order_id_display}. ${problems.join(
            "; "
          )}. No inventory was changed.`,
          "INSUFFICIENT_STOCK"
        );
      }

      for (const item of locked) {
        const [result] = await conn.execute(
          `UPDATE products
              SET qty_available = qty_available - ?
            WHERE id = ?
              AND qty_available >= ?`,
          [item.want, item.productId, item.want]
        );
        if (!result.affectedRows) {
          throw shipError(
            `Cannot ship order ${current.order_id_display}. Stock for ${item.name} changed before it could be reserved. No inventory was changed.`,
            "INSUFFICIENT_STOCK"
          );
        }
      }
    }

    const shippedAt = new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, " UTC");

    const [updated] = await conn.execute(
      `UPDATE orders
          SET status = 'shipped',
              tracking_number = ?,
              carrier = ?,
              shipped_at = ?,
              stock_reserved = 1
        WHERE order_id = ?
          AND (status IS NULL OR LOWER(status) <> 'shipped')
          AND (shipped_at IS NULL OR shipped_at = '')`,
      [tracking, carrierValue, shippedAt, n]
    );

    if (!updated.affectedRows) {
      throw shipError(
        `Order ${current.order_id_display} is already shipped. Inventory was not changed.`,
        "ALREADY_SHIPPED"
      );
    }

    await conn.commit();
    started = false;

    return {
      alreadyShipped: false,
      stockDecremented: !alreadyHeld,
      order: mapOrder({
        ...row,
        status: "shipped",
        tracking_number: tracking,
        carrier: carrierValue,
        shipped_at: shippedAt,
        stock_reserved: 1,
      }),
    };
  } catch (err) {
    if (started) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        console.error("Ship rollback failed:", rollbackErr);
      }
    }
    throw err;
  } finally {
    conn.release();
  }
}

async function listOrders() {
  const [rows] = await getPool().query(
    "SELECT * FROM orders ORDER BY order_id DESC"
  );
  return rows.map(mapOrder);
}

/**
 * Look up a single order by numeric id or padded display id ("0001").
 */
async function getOrder(orderId) {
  const n = parseInt(String(orderId), 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  const [rows] = await getPool().execute(
    "SELECT * FROM orders WHERE order_id = ?",
    [n]
  );
  return mapOrder(rows[0]);
}

/**
 * Expand order product_id / product_name into receipt line items.
 * product_id is stored like "wave-mug×1, tide-tote×2".
 * Pulls live catalog details (image, price, description) when still available.
 */
async function getOrderLineItems(order) {
  if (!order) return [];

  const tokens = parseOrderItemTokens(order);
  const items = [];
  for (const token of tokens) {
    const product = await getProduct(token.productId);

    let name = (product && product.name) || token.nameToken || token.productId;
    name = String(name)
      .replace(/\s*×\s*\d+\s*$/, "")
      .trim();

    const unitPrice = product ? product.price : null;
    const lineTotal = unitPrice !== null ? unitPrice * token.quantity : null;

    items.push({
      productId: token.productId,
      name,
      quantity: token.quantity,
      description: product ? product.description : "",
      image: product ? product.image : null,
      unitPrice,
      lineTotal,
      stillListed: Boolean(product),
    });
  }
  return items;
}

/**
 * Orders for the Ship tab: unshipped first, then newest order id.
 * Each row includes line items, a catalog total when every price is known,
 * and the customer name when the email matches an account.
 */
async function listShipQueue() {
  const orders = await listOrders();
  const nameCache = new Map();
  const queue = [];

  for (const order of orders) {
    const lineItems = await getOrderLineItems(order);
    const subtotal = orderSubtotal(lineItems);
    const hasPrices =
      lineItems.length > 0 &&
      lineItems.every((item) => item.unitPrice !== null);

    const email = String(order.email || "").trim();
    let customerName = "";
    if (email) {
      const key = email.toLowerCase();
      if (!nameCache.has(key)) {
        const customer = await getCustomerByEmail(key);
        nameCache.set(key, customer && customer.name ? customer.name : "");
      }
      customerName = nameCache.get(key) || "";
    }

    queue.push({
      ...order,
      lineItems,
      subtotal,
      hasPrices,
      customerName,
    });
  }

  queue.sort((a, b) => {
    const rankA = a.status === "shipped" ? 1 : 0;
    const rankB = b.status === "shipped" ? 1 : 0;
    if (rankA !== rankB) return rankA - rankB;
    return Number(b.order_id) - Number(a.order_id);
  });

  return queue;
}

function orderSubtotal(lineItems) {
  return lineItems.reduce((sum, item) => {
    if (item.lineTotal === null || item.lineTotal === undefined) return sum;
    return sum + item.lineTotal;
  }, 0);
}

async function listIpCounts() {
  const [rows] = await getPool().query(
    "SELECT * FROM ip_order_counts ORDER BY order_count DESC"
  );
  return rows;
}

/**
 * Reset the per-IP order counter (rate limit only — does not delete orders).
 * Pass an IP to reset one row, or omit to clear every counter.
 * Returns number of rows removed/reset.
 */
async function resetIpCount(ipAddress) {
  if (ipAddress) {
    const [result] = await getPool().execute(
      "DELETE FROM ip_order_counts WHERE ip_address = ?",
      [String(ipAddress)]
    );
    return result.affectedRows;
  }
  const [result] = await getPool().query("DELETE FROM ip_order_counts");
  return result.affectedRows;
}

async function deleteOrdersByEmail(emailFragment) {
  const fragment = String(emailFragment || "")
    .trim()
    .toLowerCase();
  if (!fragment) return 0;

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    const [matches] = await conn.execute(
      "SELECT order_id, ip_address FROM orders WHERE LOWER(email) LIKE ?",
      [`%${fragment}%`]
    );

    if (matches.length === 0) {
      await conn.commit();
      return 0;
    }

    for (const m of matches) {
      await conn.execute("DELETE FROM orders WHERE order_id = ?", [m.order_id]);
    }

    await conn.query("DELETE FROM ip_order_counts");
    await conn.query(
      `INSERT INTO ip_order_counts (ip_address, order_count)
       SELECT ip_address, COUNT(*) FROM orders GROUP BY ip_address`
    );

    await conn.commit();
    return matches.length;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

function mapCustomer(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    email: row.email,
    name: row.name || "",
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

async function getCustomerByEmail(email) {
  const [rows] = await getPool().execute(
    "SELECT * FROM customers WHERE email = ? LIMIT 1",
    [String(email || "").trim().toLowerCase()]
  );
  return mapCustomer(rows[0]);
}

async function getCustomerById(id) {
  const [rows] = await getPool().execute(
    "SELECT * FROM customers WHERE id = ? LIMIT 1",
    [id]
  );
  return mapCustomer(rows[0]);
}

async function createCustomer({ email, passwordHash, name }) {
  const createdAt = new Date().toISOString();
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanName = String(name || "").trim();
  const [result] = await getPool().execute(
    `INSERT INTO customers (email, password_hash, name, created_at)
     VALUES (?, ?, ?, ?)`,
    [cleanEmail, passwordHash, cleanName, createdAt]
  );
  return getCustomerById(result.insertId);
}

function publicCustomer(customer) {
  if (!customer) return null;
  return { id: customer.id, email: customer.email, name: customer.name || "" };
}

function reviveSession(raw) {
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data && data.cookie && data.cookie.expires) {
    data.cookie.expires = new Date(data.cookie.expires);
  }
  return data;
}

function sessionExpiry(sess) {
  const exp = sess && sess.cookie && sess.cookie.expires;
  if (exp) {
    const t = new Date(exp).getTime();
    if (Number.isFinite(t)) return String(t);
  }
  const maxAge = sess && sess.cookie && Number(sess.cookie.maxAge);
  if (Number.isFinite(maxAge) && maxAge > 0) {
    return String(Date.now() + maxAge);
  }
  return String(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

async function getSession(sid) {
  if (!dbReady || !sid) return null;
  const [rows] = await getPool().execute(
    "SELECT data, expires_at FROM sessions WHERE session_id = ?",
    [sid]
  );
  if (!rows[0]) return null;
  if (Number(rows[0].expires_at) <= Date.now()) {
    await destroySession(sid);
    return null;
  }
  return reviveSession(rows[0].data);
}

async function saveSession(sid, sess) {
  if (!dbReady || !sid || !sess) return;
  const data = JSON.stringify(sess);
  const expires = sessionExpiry(sess);
  const p = getPool();
  if (p.__sqlite) {
    await p.execute(
      `INSERT INTO sessions (session_id, data, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         data = excluded.data,
         expires_at = excluded.expires_at`,
      [sid, data, expires]
    );
    return;
  }
  await p.execute(
    `INSERT INTO sessions (session_id, data, expires_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       data = VALUES(data),
       expires_at = VALUES(expires_at)`,
    [sid, data, expires]
  );
}

async function destroySession(sid) {
  if (!dbReady || !sid) return;
  await getPool().execute("DELETE FROM sessions WHERE session_id = ?", [sid]);
}

async function touchSession(sid, sess) {
  if (!dbReady || !sid) return;
  await getPool().execute(
    "UPDATE sessions SET expires_at = ? WHERE session_id = ?",
    [sessionExpiry(sess), sid]
  );
}

/** Close the pool (tests / graceful shutdown). */
async function closeDb() {
  dbReady = false;
  if (pool) {
    await pool.end();
    pool = null;
  }
}

function isReady() {
  return dbReady;
}

module.exports = {
  initDb,
  closeDb,
  formatOrderId,
  listProducts,
  getProduct,
  productIdExists,
  createProduct,
  updateProductImage,
  updateProductPricing,
  isReady,
  getIpOrderCount,
  canPlaceOrder,
  issueCheckoutToken,
  describeCheckout,
  placeCheckoutOrder,
  insertUnreservedOrder,
  clearAbuseEvents,
  cleanupRetention,
  countUnusedCheckoutTokens,
  setCheckoutTokenCreatedAt,
  insertAbuseEvent,
  countAbuseEvents,
  mailRetrySettings,
  listDueMail,
  claimMailOutbox,
  renewMailClaim,
  finishMailOutbox,
  getMailOutboxByOrderId,
  listOrders,
  listShipQueue,
  shipOrder,
  getOrder,
  getOrderLineItems,
  orderSubtotal,
  listIpCounts,
  resetIpCount,
  deleteOrdersByEmail,
  getCustomerByEmail,
  getCustomerById,
  createCustomer,
  publicCustomer,
  getSession,
  saveSession,
  destroySession,
  touchSession,
};
