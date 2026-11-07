/**
 * Real MySQL, 15 OS processes, one shared IP.
 * Skipped unless RUN_MYSQL_BURST=1. The server must be reachable with the
 * MYSQL_* settings below (this file starts the app itself).
 */
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const path = require("path");
const { test } = require("node:test");
const mysql = require("mysql2/promise");

const ROOT = path.join(__dirname, "..");
const PORT = 4877;
const DB = "ocean_burst";

async function waitForHealth(url) {
  const deadline = Date.now() + 30000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
      last = String(res.status);
    } catch (err) {
      last = err.message || String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("server did not become ready: " + last);
}

function runWorker(email) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, "mysql-burst-worker.js")], {
      cwd: ROOT,
      env: {
        ...process.env,
        BASE_URL: `http://127.0.0.1:${PORT}`,
        BURST_EMAIL: email,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({
        code,
        status: Number(stdout.trim() || "0"),
        stderr,
      });
    });
  });
}

test(
  "MySQL 15-process same-IP burst stays at the cap with no 500s",
  { skip: process.env.RUN_MYSQL_BURST !== "1" },
  async () => {
    const admin = await mysql.createConnection({
      host: "127.0.0.1",
      user: "ocean",
      password: "ocean_pass",
      multipleStatements: true,
    });
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await admin.query(`DROP DATABASE \`${DB}\``);
    await admin.query(
      `CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await admin.end();

    const env = { ...process.env };
    delete env.SQLITE_FILE;
    env.PORT = String(PORT);
    env.HOST = "127.0.0.1";
    env.NODE_ENV = "test";
    env.COOKIE_SECURE = "0";
    env.ADMIN_PASSWORD = "test-admin-password";
    env.SESSION_SECRET = "burst-session-secret";
    env.MYSQL_HOST = "127.0.0.1";
    env.MYSQL_PORT = "3306";
    env.MYSQL_USER = "ocean";
    env.MYSQL_PASSWORD = "ocean_pass";
    env.MYSQL_DATABASE = DB;
    env.MYSQL_SSL = "false";
    env.ORDER_RATE_LIMIT_IP = "5";
    env.ORDER_RATE_LIMIT_EMAIL = "100";
    env.MAIL_RATE_LIMIT_IP = "100";
    env.MAIL_RATE_LIMIT_EMAIL = "100";
    env.ORDER_RATE_WINDOW_SEC = "3600";
    env.MAIL_RATE_WINDOW_SEC = "3600";
    env.CHECKOUT_LOCK_RETRIES = "5";

    const server = spawn(process.execPath, ["app.js"], {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let serverLog = "";
    server.stdout.on("data", (chunk) => {
      serverLog += chunk.toString();
    });
    server.stderr.on("data", (chunk) => {
      serverLog += chunk.toString();
    });

    try {
      await waitForHealth(`http://127.0.0.1:${PORT}/healthz`);
      const results = await Promise.all(
        Array.from({ length: 15 }, (_, i) => runWorker(`burst-${i}@example.com`))
      );
      const statuses = results.map((result) => result.status);
      const orders = statuses.filter((status) => status === 200).length;
      const limited = statuses.filter((status) => status === 429).length;
      const failed = results.filter((result) => result.status >= 500 || result.status === 0);
      assert.deepEqual(
        { orders, limited, failed: failed.map((result) => ({
          status: result.status,
          stderr: result.stderr.slice(0, 300),
        })) },
        { orders: 5, limited: 10, failed: [] }
      );

      const conn = await mysql.createConnection({
        host: "127.0.0.1",
        user: "ocean",
        password: "ocean_pass",
        database: DB,
      });
      const [rows] = await conn.query("SELECT COUNT(*) AS n FROM orders");
      await conn.end();
      assert.equal(Number(rows[0].n), 5);
    } catch (err) {
      err.message += "\n--- server log ---\n" + serverLog.slice(-4000);
      throw err;
    } finally {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.on("close", resolve));
    }
  }
);
