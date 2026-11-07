-- Ocean Market — MySQL database bootstrap (static / local fallback)
-- Prefer:  npm run db:init   (uses MYSQL_* from .env via scripts/init-db.js)
--
-- Creates database `ocean`, app user, grants, and empty tables.
-- Tables are also ensured by the app on startup (db.initDb).
--
-- Manual usage (as MySQL root or an admin account):
--
--   sudo mysql < scripts/init-ocean.sql
--   # or:
--   mysql -u root -p < scripts/init-ocean.sql
--
-- Then set matching credentials in .env (see .env.example).

CREATE DATABASE IF NOT EXISTS ocean
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- Local app user (matches .env.example defaults). Change the password for production.
CREATE USER IF NOT EXISTS 'ocean'@'localhost' IDENTIFIED BY 'ocean_pass@122U';
CREATE USER IF NOT EXISTS 'ocean'@'127.0.0.1' IDENTIFIED BY 'ocean_pass@122U';

GRANT ALL PRIVILEGES ON ocean.* TO 'ocean'@'localhost';
GRANT ALL PRIVILEGES ON ocean.* TO 'ocean'@'127.0.0.1';
FLUSH PRIVILEGES;

USE ocean;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ip_order_counts (
  ip_address  VARCHAR(64) NOT NULL,
  order_count INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  session_id  VARCHAR(128) NOT NULL,
  data        TEXT         NOT NULL,
  expires_at  VARCHAR(32)  NOT NULL,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS checkout_tokens (
  token        VARCHAR(64)  NOT NULL,
  session_id   VARCHAR(128) NOT NULL,
  intent       TEXT         NOT NULL,
  created_at   VARCHAR(64)  NOT NULL,
  order_id     INT          NULL,
  consumed_at  VARCHAR(64)  NULL,
  PRIMARY KEY (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS abuse_events (
  id          INT          NOT NULL AUTO_INCREMENT,
  action      VARCHAR(32)  NOT NULL,
  ip_address  VARCHAR(64)  NOT NULL,
  email       VARCHAR(255) NULL,
  created_at  VARCHAR(32)  NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limit_locks (
  lock_key VARCHAR(320) NOT NULL,
  PRIMARY KEY (lock_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
