-- Checkout abuse guards (additive).
--
-- Safe to inspect against the production database. It creates new tables and
-- adds orders.stock_reserved only when that column is missing.
-- It does not UPDATE, DELETE, or cancel existing orders.
--
-- stock_reserved defaults to 0. Those older rows still decrement product
-- stock when they ship. New checkouts set stock_reserved = 1 and decrement
-- at checkout, so ship must not decrement them again.
--
-- The app also applies this on startup (db.initDb) and via `npm run db:init`.

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

DROP PROCEDURE IF EXISTS ocean_add_stock_reserved;

DELIMITER $$

CREATE PROCEDURE ocean_add_stock_reserved()
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'orders'
       AND COLUMN_NAME = 'stock_reserved'
  ) THEN
    ALTER TABLE orders
      ADD COLUMN stock_reserved TINYINT NOT NULL DEFAULT 0;
  END IF;
END$$

DELIMITER ;

CALL ocean_add_stock_reserved();

DROP PROCEDURE IF EXISTS ocean_add_stock_reserved;
