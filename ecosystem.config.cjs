/**
 * Example PM2 process file for Ocean Market.
 *
 * Secrets and most settings come from `.env` (loaded by the app via dotenv).
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
 * Update after deploy:
 *   pm2 restart ocean-market
 *   # or: pm2 reload ecosystem.config.cjs
 *
 * Stop / remove:
 *   pm2 stop ocean-market
 *   pm2 delete ocean-market
 *
 * Notes:
 * - Use a single fork instance. Sessions are in-memory (express-session);
 *   clustering needs a shared session store and sticky load balancing.
 * - Prefer HOST=127.0.0.1 behind nginx; set TRUST_PROXY and COOKIE_SECURE in .env.
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
      min_uptime: "10s",
      max_restarts: 20,
      restart_delay: 3000,

      // Defaults only; override via .env (PORT, HOST, MYSQL_*, SMTP_*, etc.)
      env: {
        NODE_ENV: "production",
      },

      // Optional: separate log files under ./logs (create dir if missing)
      // error_file: "./logs/pm2-error.log",
      // out_file: "./logs/pm2-out.log",
      // merge_logs: true,
      // time: true,
    },
  ],
};
