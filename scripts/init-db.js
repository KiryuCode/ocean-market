/**
 * Bootstrap MySQL using credentials from .env (MYSQL_*).
 *
 * Usage:  npm run db:init
 *
 * Connects as MYSQL_USER by default. For local setups where you need an
 * admin account to create the database/app user, set:
 *   MYSQL_ADMIN_USER / MYSQL_ADMIN_PASSWORD
 *   (or MYSQL_ROOT_USER / MYSQL_ROOT_PASSWORD)
 *
 * Creates:
 *   - database MYSQL_DATABASE (best-effort if privileges allow)
 *   - app user MYSQL_USER (only when connecting as a different admin)
 *   - products, orders, ip_order_counts tables
 */

require("dotenv").config();

const mysql = require("mysql2/promise");
const { getMysqlConfig } = require("../config");

function assertIdent(name, label) {
  if (!name || !/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `Invalid ${label}: ${JSON.stringify(name)} (letters, numbers, underscore only)`
    );
  }
  return name;
}

function isLocalHost(host) {
  return (
    !host ||
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1"
  );
}

async function ensureTables(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS products (
      id            VARCHAR(64)   NOT NULL,
      name          VARCHAR(255)  NOT NULL,
      price         DECIMAL(10,2) NOT NULL,
      description   TEXT          NOT NULL,
      image         VARCHAR(1024) NOT NULL,
      qty_available INT           NOT NULL DEFAULT 25,
      sort_order    INT           NOT NULL DEFAULT 0,
      created_at    VARCHAR(64)   NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
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

  await conn.query(`
    CREATE TABLE IF NOT EXISTS ip_order_counts (
      ip_address  VARCHAR(64) NOT NULL,
      order_count INT         NOT NULL DEFAULT 0,
      PRIMARY KEY (ip_address)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id  VARCHAR(128) NOT NULL,
      data        TEXT         NOT NULL,
      expires_at  VARCHAR(32)  NOT NULL,
      PRIMARY KEY (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
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

  await conn.query(`
    CREATE TABLE IF NOT EXISTS abuse_events (
      id          INT          NOT NULL AUTO_INCREMENT,
      action      VARCHAR(32)  NOT NULL,
      ip_address  VARCHAR(64)  NOT NULL,
      email       VARCHAR(255) NULL,
      created_at  VARCHAR(32)  NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureOrderShippingColumns(conn);
}

async function ensureOrderShippingColumns(conn) {
  const columns = [
    ["status", "VARCHAR(32) NOT NULL DEFAULT 'unshipped'"],
    ["tracking_number", "VARCHAR(128) NULL"],
    ["carrier", "VARCHAR(64) NULL"],
    ["shipped_at", "VARCHAR(64) NULL"],
    ["stock_reserved", "TINYINT NOT NULL DEFAULT 0"],
  ];
  for (const [column, definition] of columns) {
    const [rows] = await conn.query(
      `SELECT 1 AS ok
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'orders'
          AND COLUMN_NAME = ?
        LIMIT 1`,
      [column]
    );
    if (!rows.length) {
      await conn.query(
        "ALTER TABLE `orders` ADD COLUMN `" + column + "` " + definition
      );
      console.log(`Added orders.${column}`);
    }
  }
}

async function ensureAppUser(conn, appUser, appPassword, clientHosts) {
  for (const host of clientHosts) {
    const userAtHost = `${mysql.escape(appUser)}@${mysql.escape(host)}`;
    const pass = mysql.escape(appPassword);
    await conn.query(
      `CREATE USER IF NOT EXISTS ${userAtHost} IDENTIFIED BY ${pass}`
    );
    // Keep password in sync with .env when re-running init
    await conn.query(`ALTER USER ${userAtHost} IDENTIFIED BY ${pass}`);
  }
}

async function main() {
  const cfg = getMysqlConfig();
  const database = assertIdent(cfg.database, "MYSQL_DATABASE");
  const appUser = assertIdent(cfg.user, "MYSQL_USER");
  const appPassword = cfg.password != null ? String(cfg.password) : "";

  const adminUser =
    process.env.MYSQL_ADMIN_USER || process.env.MYSQL_ROOT_USER || "";
  const adminPassword =
    process.env.MYSQL_ADMIN_PASSWORD ??
    process.env.MYSQL_ROOT_PASSWORD ??
    "";

  const connectAsAdmin = Boolean(adminUser);
  const user = connectAsAdmin ? adminUser : appUser;
  const password = connectAsAdmin ? String(adminPassword) : appPassword;

  const baseOptions = {
    host: cfg.host,
    port: cfg.port,
    user,
    password,
    multipleStatements: false,
  };
  if (cfg.ssl) {
    baseOptions.ssl = cfg.ssl;
  }

  console.log(
    `Connecting to MySQL as ${user}@${cfg.host}:${cfg.port}` +
      (connectAsAdmin ? " (admin bootstrap)" : "")
  );

  const conn = await mysql.createConnection(baseOptions);

  try {
    try {
      await conn.query(
        `CREATE DATABASE IF NOT EXISTS \`${database}\` ` +
          `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
      console.log(`Database ready: ${database}`);
    } catch (err) {
      // Managed hosts often pre-create the DB and deny CREATE DATABASE.
      if (
        err.code === "ER_DBACCESS_DENIED_ERROR" ||
        err.code === "ER_SPECIFIC_ACCESS_DENIED_ERROR" ||
        err.code === "ER_ACCESS_DENIED_ERROR"
      ) {
        console.warn(
          `Could not CREATE DATABASE ${database} (${err.code}); assuming it exists.`
        );
      } else {
        throw err;
      }
    }

    if (connectAsAdmin && adminUser !== appUser) {
      const clientHosts = isLocalHost(cfg.host)
        ? ["localhost", "127.0.0.1"]
        : ["%"];
      console.log(
        `Ensuring app user ${appUser} (hosts: ${clientHosts.join(", ")})`
      );
      await ensureAppUser(conn, appUser, appPassword, clientHosts);
      for (const host of clientHosts) {
        await conn.query(
          `GRANT ALL PRIVILEGES ON \`${database}\`.* TO ${mysql.escape(
            appUser
          )}@${mysql.escape(host)}`
        );
      }
      await conn.query("FLUSH PRIVILEGES");
      console.log(`Granted ${appUser} on ${database}.*`);
    }

    await conn.changeUser({ database });
    await ensureTables(conn);
    console.log(
      "Tables ready: products, orders, ip_order_counts, sessions, checkout_tokens, abuse_events"
    );
    console.log("db:init complete.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("db:init failed:", err.message || err);
  process.exit(1);
});
