/**
 * PM2 process file for Ocean Market.
 *
 * Secrets come from .env (loaded by the app from __dirname).
 *
 * Important for fnm hosts:
 *   Do NOT rely on ephemeral multishell paths like
 *   /run/user/0/fnm_multishells/... — they disappear after reboot and PM2
 *   ends up "online" with pid N/A (502 bad gateway). This file resolves the
 *   stable node binary under ~/.local/share/fnm/node-versions/...
 *
 * Install and run:
 *   npm i -g pm2
 *   # prefer stable PATH when saving the dump:
 *   export PATH="$(dirname $(readlink -f $(which node))):/usr/local/bin:/usr/bin:/bin"
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup
 *
 * Update after deploy:
 *   pm2 delete ocean-market 2>/dev/null; pm2 start ecosystem.config.cjs; pm2 save
 */

const fs = require("fs");
const path = require("path");

function resolveNodeInterpreter() {
  const home = process.env.HOME || "/root";
  const fnmDir = process.env.FNM_DIR || path.join(home, ".local/share/fnm");
  const versionsDir = path.join(fnmDir, "node-versions");
  try {
    if (fs.existsSync(versionsDir)) {
      const versions = fs
        .readdirSync(versionsDir)
        .filter((v) => v.startsWith("v"))
        .sort();
      for (let i = versions.length - 1; i >= 0; i -= 1) {
        const nodePath = path.join(
          versionsDir,
          versions[i],
          "installation",
          "bin",
          "node"
        );
        if (fs.existsSync(nodePath)) return nodePath;
      }
    }
  } catch (_) {
    /* ignore */
  }
  // Prefer realpath so /usr/local/bin/node symlinks resolve to a real binary
  for (const candidate of ["/usr/local/bin/node", "/usr/bin/node"]) {
    try {
      if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    } catch (_) {
      /* ignore */
    }
  }
  try {
    const real = fs.realpathSync(process.execPath);
    // Avoid saving ephemeral fnm multishell paths into the PM2 dump
    if (!real.includes("fnm_multishells")) return real;
  } catch (_) {
    /* ignore */
  }
  return "node";
}

const interpreter = resolveNodeInterpreter();
const interpreterDir = path.dirname(interpreter);

module.exports = {
  apps: [
    {
      name: "ocean-market",
      script: "app.js",
      cwd: __dirname,
      interpreter,

      // Single process (in-memory sessions — do not use cluster without a shared store)
      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      min_uptime: "10s",
      max_restarts: 40,
      restart_delay: 4000,
      exp_backoff_restart_delay: 1000,

      // Stable PATH only — never bake /run/user/.../fnm_multishells into the dump
      env: {
        NODE_ENV: "production",
        PATH: `${interpreterDir}:/usr/local/bin:/usr/bin:/bin`,
      },

      time: true,
    },
  ],
};
