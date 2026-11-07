-- Mail outbox and rate-limit locks (additive).
--
-- Creates new tables only. It does not UPDATE, DELETE, or cancel orders.
-- The app also creates these on startup (db.initDb) and via npm run db:init.
--
-- rate_limit_locks: one row per IP/email bucket so the limit check and the
-- consuming insert share a lock.
-- mail_outbox: one row per order. SMTP failures stay queued and retry until
-- sent or the attempt cap. A second send of the same order does not go out.

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
