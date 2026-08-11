/**
 * Example PM2 process file for Ocean Market.
 *
 * Secrets and most settings come from .env (loaded by the app from __dirname).
 * Do not put passwords or SESSION_SECRET in this file.
 *
 * Install and run:
 *   npm i -g pm2
 *   cp .env.example .env   # if needed, then edit
 *   npm ci
 *   npm run db:init
 *   pm2 start ecosystem.config.cjs
 *   pm2 status
 *   pm2 logs ocean-market
 *   pm2 save && pm2 startup   # survive reboots
 *
 * After reboot MySQL may start a few seconds after PM2; the app retries
 * DB connect before listening. Prefer also ordering MySQL before PM2:
 *   sudo systemctl edit pm2-root   # or pm2-$(whoami)
 *   [Unit]
 *   After=network-online.target mysql.service mysqld.service
 *   Wants=network-online.target
 *
 * Update after deploy:
 *   pm2 restart ocean-market --update-env
 *
 * Stop / remove:
 *   pm2 stop ocean-market
 *   pm2 delete ocean-market
 *
 * Notes:
 * - Single fork instance (in-memory sessions).
 * - Prefer HOST=127.0.0.1 behind nginx; TRUST_PROXY + COOKIE_SECURE in .env.
 */

module.exports = {
  apps: [
    {
      name: "ocean-market",
      script: "app.js",
      cwd: __dirname,

      // Single process (in-memory sessions — do not use cluster without a shared store)
      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      // Survive MySQL coming up late after reboot without exhausting restarts
      min_uptime: "10s",
      max_restarts: 40,
      restart_delay: 4000,
      exp_backoff_restart_delay: 1000,

      // Defaults only; PORT / HOST / MYSQL_* / SMTP_* come from .env via dotenv
      env: {
        NODE_ENV: "production",
      },

      // Helpful when diagnosing reboot issues
      time: true,
    },
  ],
};
