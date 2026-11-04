/**
 * MySQL helpers for orders, products, and per-IP rate limiting.
 *
 * Tables:
 *   - products:        catalog (editable from admin, with photo uploads)
 *   - orders:          order_id (integer, shown as 0001), product ordered, email, timestamp,
 *                      status, tracking number, carrier, shipped timestamp
 *   - ip_order_counts: ip_address, order_count  (separate table for the 20/order limit)
 *
 * Connection settings come from .env (MYSQL_*). Create the database first with:
 *   mysql -u root -p < scripts/init-ocean.sql
 */

const mysql = require("mysql2/promise");

const {
  MAX_ORDERS_PER_IP,
  DEFAULT_PRODUCTS,
  getMysqlConfig,
} = require("./config");

/** Display width for order IDs (1 → "0001") */
const ORDER_ID_PAD = 4;

/** Default stock when not specified */
const DEFAULT_QTY = 25;

/** @type {import("mysql2/promise").Pool | null} */
let pool = null;

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

  await p.query(`
    CREATE TABLE IF NOT EXISTS ip_order_counts (
      ip_address  VARCHAR(64) NOT NULL,
      order_count INT         NOT NULL DEFAULT 0,
      PRIMARY KEY (ip_address)
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
 */
async function updateProductPricing(productId, { price, qtyAvailable }) {
  const product = await getProduct(productId);
  if (!product) return false;

  const nextPrice =
    price !== undefined && price !== null && price !== ""
      ? Number(price)
      : product.price;
  const nextQty =
    qtyAvailable !== undefined && qtyAvailable !== null && qtyAvailable !== ""
      ? Math.max(0, Math.floor(Number(qtyAvailable)))
      : product.qtyAvailable;

  if (!Number.isFinite(nextPrice) || nextPrice < 0) {
    throw new Error("Enter a valid price.");
  }
  if (!Number.isFinite(nextQty) || nextQty < 0) {
    throw new Error("Enter a valid quantity.");
  }

  const [result] = await getPool().execute(
    "UPDATE products SET price = ?, qty_available = ? WHERE id = ?",
    [nextPrice, nextQty, productId]
  );
  return result.affectedRows > 0;
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

async function createOrder({ productId, productName, email, phone, ipAddress }) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      "SELECT order_count FROM ip_order_counts WHERE ip_address = ? FOR UPDATE",
      [ipAddress]
    );
    const current = rows[0] ? Number(rows[0].order_count) : 0;

    if (current >= MAX_ORDERS_PER_IP) {
      throw new Error(
        `Order limit reached for this address (${MAX_ORDERS_PER_IP} orders maximum).`
      );
    }

    const createdAt = new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, " UTC");
    const cleanEmail = (email || "").trim() || null;
    const cleanPhone = (phone || "").trim() || null;

    const [insertResult] = await conn.execute(
      `INSERT INTO orders
         (product_id, product_name, email, phone, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [productId, productName, cleanEmail, cleanPhone, ipAddress, createdAt]
    );

    if (rows[0]) {
      await conn.execute(
        "UPDATE ip_order_counts SET order_count = order_count + 1 WHERE ip_address = ?",
        [ipAddress]
      );
    } else {
      await conn.execute(
        "INSERT INTO ip_order_counts (ip_address, order_count) VALUES (?, 1)",
        [ipAddress]
      );
    }

    await conn.commit();
    return formatOrderId(insertResult.insertId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
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
      return { alreadyShipped: true, order: current };
    }

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

    const shippedAt = new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, " UTC");

    const [updated] = await conn.execute(
      `UPDATE orders
          SET status = 'shipped',
              tracking_number = ?,
              carrier = ?,
              shipped_at = ?
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
      order: mapOrder({
        ...row,
        status: "shipped",
        tracking_number: tracking,
        carrier: carrierValue,
        shipped_at: shippedAt,
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

/** Close the pool (tests / graceful shutdown). */
async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
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
  getIpOrderCount,
  canPlaceOrder,
  createOrder,
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
};
