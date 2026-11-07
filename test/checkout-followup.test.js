/**
 * Follow-up: rate-limit bursts, mail retry, token retention,
 * and an admin quantity save racing a checkout.
 */
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, test, before, after, beforeEach } = require("node:test");
const request = require("supertest");

const sqliteFile = path.join(os.tmpdir(), `ocean-followup-${process.pid}.sqlite`);

process.env.SQLITE_FILE = sqliteFile;
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.SESSION_SECRET = "test-session-secret";
process.env.NODE_ENV = "test";
process.env.COOKIE_SECURE = "0";
process.env.ORDER_RATE_LIMIT_IP = "100";
process.env.ORDER_RATE_LIMIT_EMAIL = "100";
process.env.MAIL_RATE_LIMIT_IP = "100";
process.env.MAIL_RATE_LIMIT_EMAIL = "100";
process.env.ORDER_RATE_WINDOW_SEC = "3600";
process.env.MAIL_RATE_WINDOW_SEC = "3600";
process.env.ORDER_FAIL_LIMIT = "8";
delete process.env.TRUST_PROXY;
delete process.env.MAIL_RETRY_BASE_MS;
delete process.env.MAIL_MAX_ATTEMPTS;

const app = require("../app");
const db = require("../db");
const mail = require("../mail");

const sent = [];
function succeedSend(payload) {
  sent.push(payload);
  return { ok: true, messageId: `test-${sent.length}` };
}
mail.sendOrderConfirmation = async (payload) => succeedSend(payload);

function csrfOf(html) {
  const match = String(html).match(/name="csrf-token" content="([^"]*)"/);
  assert.ok(match, "csrf token missing");
  return match[1];
}

function checkoutTokenOf(html) {
  const match = String(html).match(/name="checkout_token" value="([^"]*)"/);
  assert.ok(match && match[1], "checkout token missing");
  return match[1];
}

function orderIdOf(html) {
  const match = String(html).match(/data-order-id="([^"]+)"/);
  assert.ok(match, "order id missing");
  return match[1];
}

function sessionIdOf(res) {
  const cookies = res.headers["set-cookie"] || [];
  const raw = cookies.find((cookie) => cookie.startsWith("ocean.sid="));
  assert.ok(raw, "session cookie missing");
  const value = decodeURIComponent(raw.split(";")[0].slice("ocean.sid=".length));
  const body = value.slice(2);
  return body.slice(0, body.lastIndexOf("."));
}

async function stock(productId) {
  return (await db.getProduct(productId)).qtyAvailable;
}

async function openBuy(agent, productId) {
  const page = await agent.get(`/buy/${productId}`);
  assert.equal(page.status, 200);
  return {
    page,
    csrf: csrfOf(page.text),
    checkoutToken: checkoutTokenOf(page.text),
  };
}

async function postConfirm(agent, fields) {
  return agent.post("/confirm").type("form").send(fields);
}

async function burst(productId, count, emailFor) {
  const forms = [];
  for (let i = 0; i < count; i += 1) {
    const agent = request.agent(app);
    const form = await openBuy(agent, productId);
    forms.push({ agent, form, email: emailFor(i) });
  }
  return Promise.all(
    forms.map(({ agent, form, email }) =>
      postConfirm(agent, {
        _csrf: form.csrf,
        checkout_token: form.checkoutToken,
        mode: "buy_now",
        product_id: productId,
        email,
      })
    )
  );
}

describe("checkout follow-up", { concurrency: false }, () => {
  before(async () => {
    fs.rmSync(sqliteFile, { force: true });
    await app.ready();
  });

  after(async () => {
    await db.closeDb();
    fs.rmSync(sqliteFile, { force: true });
  });

  beforeEach(async () => {
    sent.length = 0;
    mail.sendOrderConfirmation = async (payload) => succeedSend(payload);
    process.env.ORDER_RATE_LIMIT_IP = "100";
    process.env.ORDER_RATE_LIMIT_EMAIL = "100";
    process.env.MAIL_RATE_LIMIT_IP = "100";
    process.env.MAIL_RATE_LIMIT_EMAIL = "100";
    process.env.ORDER_FAIL_LIMIT = "8";
    delete process.env.MAIL_RETRY_BASE_MS;
    delete process.env.MAIL_MAX_ATTEMPTS;
    delete process.env.MAIL_SEND_LEASE_MS;
    delete process.env.MAIL_SMTP_TIMEOUT_MS;
    await db.clearAbuseEvents();
    await db.resetIpCount();
  });

  test("an email cap of 3 holds for a 12-request burst", async () => {
    process.env.ORDER_RATE_LIMIT_EMAIL = "3";
    process.env.ORDER_FAIL_LIMIT = "4";
    await db.updateProductPricing("rosemary", { qtyAvailable: 30 });
    const results = await burst("rosemary", 12, () => "burst-email@example.com");
    const ok = results.filter((res) => res.status === 200);
    const limited = results.filter((res) => res.status === 429);
    assert.equal(ok.length, 3);
    assert.equal(limited.length, 9);
    assert.equal(sent.length, 3);
    assert.equal(
      await db.countAbuseEvents({
        action: "order_create",
        email: "burst-email@example.com",
      }),
      3
    );
    assert.equal(
      await db.countAbuseEvents({
        action: "order_fail",
        email: "burst-email@example.com",
      }),
      4
    );
  });

  test("an IP cap of 5 holds for a 15-request burst", async () => {
    process.env.ORDER_RATE_LIMIT_IP = "5";
    await db.updateProductPricing("thyme", { qtyAvailable: 30 });
    const results = await burst(
      "thyme",
      15,
      (i) => `burst-ip-${i}@example.com`
    );
    const ok = results.filter((res) => res.status === 200);
    assert.equal(ok.length, 5);
    assert.equal(results.filter((res) => res.status === 429).length, 10);
    assert.equal(sent.length, 5);
    assert.equal(
      await db.countAbuseEvents({ action: "order_create", ipAddress: "127.0.0.1" }),
      5
    );
  });

  test("zero-stock retries do not store an unlimited failure log", async () => {
    process.env.ORDER_FAIL_LIMIT = "3";
    await db.updateProductPricing("basil", { qtyAvailable: 0 });
    const results = await burst("basil", 10, (i) => `zero-${i}@example.com`);
    assert.ok(results.every((res) => res.status === 409));
    assert.equal(sent.length, 0);
    assert.equal(
      await db.countAbuseEvents({ action: "order_fail", ipAddress: "127.0.0.1" }),
      3
    );
    assert.equal(await db.countAbuseEvents({ action: "order_create" }), 0);
  });

  test("a failed send stays queued and a later drain delivers it once", async () => {
    process.env.MAIL_RETRY_BASE_MS = "0";
    process.env.MAIL_MAX_ATTEMPTS = "4";
    await db.updateProductPricing("purple-coneflower", { qtyAvailable: 4 });
    let calls = 0;
    mail.sendOrderConfirmation = async () => {
      calls += 1;
      if (calls === 1) return { ok: false, error: "smtp down" };
      return { ok: true, messageId: "retried-1" };
    };
    const agent = request.agent(app);
    const form = await openBuy(agent, "purple-coneflower");
    const res = await postConfirm(agent, {
      _csrf: form.csrf,
      checkout_token: form.checkoutToken,
      mode: "buy_now",
      product_id: "purple-coneflower",
      email: "retry@example.com",
    });
    assert.equal(res.status, 200);
    const orderId = orderIdOf(res.text);
    assert.equal(calls, 1);
    let box = await db.getMailOutboxByOrderId(orderId);
    assert.equal(box.status, "pending");
    assert.equal(box.attempts, 1);

    await mail.drainOutbox();
    assert.equal(calls, 2);
    box = await db.getMailOutboxByOrderId(orderId);
    assert.equal(box.status, "sent");
    assert.equal(box.messageId, "retried-1");

    await mail.drainOutbox();
    assert.equal(calls, 2);
  });

  test("two drains cannot send the same order twice", async () => {
    await db.updateProductPricing("purple-coneflower", { qtyAvailable: 3 });
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let markStarted;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    mail.sendOrderConfirmation = async () => {
      calls += 1;
      markStarted();
      await gate;
      return { ok: true, messageId: "once" };
    };
    const agent = request.agent(app);
    const form = await openBuy(agent, "purple-coneflower");
    const checkout = postConfirm(agent, {
      _csrf: form.csrf,
      checkout_token: form.checkoutToken,
      mode: "buy_now",
      product_id: "purple-coneflower",
      email: "once@example.com",
    });
    await started;
    assert.equal(calls, 1);
    const extra = mail.drainOutbox();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(calls, 1);
    release();
    const res = await checkout;
    await extra;
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
    const box = await db.getMailOutboxByOrderId(orderIdOf(res.text));
    assert.equal(box.status, "sent");
    assert.equal(box.messageId, "once");
  });

  test("attempt cap stops retrying a message that never sends", async () => {
    process.env.MAIL_RETRY_BASE_MS = "0";
    process.env.MAIL_MAX_ATTEMPTS = "2";
    await db.updateProductPricing("thyme", { qtyAvailable: 3 });
    let calls = 0;
    mail.sendOrderConfirmation = async () => {
      calls += 1;
      return { ok: false, error: "still down" };
    };
    const agent = request.agent(app);
    const form = await openBuy(agent, "thyme");
    const res = await postConfirm(agent, {
      _csrf: form.csrf,
      checkout_token: form.checkoutToken,
      mode: "buy_now",
      product_id: "thyme",
      email: "dead@example.com",
    });
    assert.equal(res.status, 200);
    await mail.drainOutbox();
    await mail.drainOutbox();
    assert.equal(calls, 2);
    const box = await db.getMailOutboxByOrderId(orderIdOf(res.text));
    assert.equal(box.status, "dead");
    assert.equal(box.attempts, 2);
  });

  test("reloading buy now does not keep every checkout token", async () => {
    await db.updateProductPricing("basil", { qtyAvailable: 5 });
    const agent = request.agent(app);
    const first = await agent.get("/buy/basil");
    assert.equal(first.status, 200);
    const sid = sessionIdOf(first);
    assert.match(first.text, /checkout_token/);
    for (let i = 0; i < 7; i += 1) {
      const page = await agent.get("/buy/basil");
      assert.equal(page.status, 200);
    }
    assert.ok((await db.countUnusedCheckoutTokens(sid)) <= 3);
    const latest = await agent.get("/buy/basil");
    const res = await postConfirm(agent, {
      _csrf: csrfOf(latest.text),
      checkout_token: checkoutTokenOf(latest.text),
      mode: "buy_now",
      product_id: "basil",
      email: "reload@example.com",
    });
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
  });

  test("expired unused tokens and old abuse rows are deleted", async () => {
    const agent = request.agent(app);
    const form = await openBuy(agent, "basil");
    await db.setCheckoutTokenCreatedAt(
      form.checkoutToken,
      new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    );
    await db.insertAbuseEvent({
      action: "order_fail",
      ipAddress: "198.51.100.40",
      email: "old@example.com",
      createdAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    });
    await db.insertAbuseEvent({
      action: "order_fail",
      ipAddress: "198.51.100.40",
      email: "old@example.com",
      createdAt: Date.now(),
    });
    const removed = await db.cleanupRetention();
    assert.ok(removed >= 2);
    assert.equal(
      await db.countAbuseEvents({
        action: "order_fail",
        ipAddress: "198.51.100.40",
      }),
      1
    );
    const res = await postConfirm(agent, {
      _csrf: form.csrf,
      checkout_token: form.checkoutToken,
      mode: "buy_now",
      product_id: "basil",
      email: "stale-token@example.com",
    });
    assert.equal(res.status, 403);
    assert.equal(sent.length, 0);
  });

  test("admin quantity save racing a checkout does not drop the reserved unit", async () => {
    await db.updateProductPricing("basil", { qtyAvailable: 1 });
    const buyer = request.agent(app);
    const admin = request.agent(app);
    const loginPage = await admin.get("/admin");
    const signedIn = await admin.post("/admin").type("form").send({
      _csrf: csrfOf(loginPage.text),
      password: "test-admin-password",
    });
    assert.ok(signedIn.status === 302 || signedIn.status === 200);
    const products = await admin.get("/admin");
    assert.match(products.text, /name="qty_baseline"/);
    const form = await openBuy(buyer, "basil");
    const [checkoutRes] = await Promise.all([
      postConfirm(buyer, {
        _csrf: form.csrf,
        checkout_token: form.checkoutToken,
        mode: "buy_now",
        product_id: "basil",
        email: "race-admin@example.com",
      }),
      admin.post("/admin/products/basil/update").type("form").send({
        _csrf: csrfOf(products.text),
        price: "9.99",
        qty_available: "3",
        qty_baseline: "1",
      }),
    ]);
    assert.equal(checkoutRes.status, 200);
    // Baseline 1, admin asked for 3 (delta +2), checkout took 1. Final is 2
    // whichever write lands first.
    assert.equal(await stock("basil"), 2);
    assert.equal(sent.length, 1);
  });

  test("a send still inside its lease cannot be stolen", async () => {
    process.env.MAIL_SEND_LEASE_MS = "240";
    process.env.MAIL_RETRY_BASE_MS = "0";
    await db.updateProductPricing("rosemary", { qtyAvailable: 4 });
    const settings = db.mailRetrySettings();
    assert.ok(settings.smtpTimeoutMs < settings.leaseMs);

    let calls = 0;
    let markStarted;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    mail.sendOrderConfirmation = async ({ signal }) => {
      calls += 1;
      markStarted();
      await new Promise((resolve, reject) => {
        const abort = () => reject(new Error("aborted"));
        if (signal && signal.aborted) {
          abort();
          return;
        }
        if (signal) signal.addEventListener("abort", abort, { once: true });
      });
      return { ok: true, messageId: "late" };
    };

    const agent = request.agent(app);
    const form = await openBuy(agent, "rosemary");
    const checkout = postConfirm(agent, {
      _csrf: form.csrf,
      checkout_token: form.checkoutToken,
      mode: "buy_now",
      product_id: "rosemary",
      email: "lease@example.com",
    });
    await started;
    assert.equal(calls, 1);
    await mail.drainOutbox();
    assert.equal(calls, 1);
    const res = await checkout;
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
    const orderId = orderIdOf(res.text);
    let box = await db.getMailOutboxByOrderId(orderId);
    assert.equal(box.status, "pending");

    mail.sendOrderConfirmation = async () => {
      calls += 1;
      return { ok: true, messageId: "only-delivery" };
    };
    await mail.drainOutbox();
    assert.equal(calls, 2);
    box = await db.getMailOutboxByOrderId(orderId);
    assert.equal(box.status, "sent");
    assert.equal(box.messageId, "only-delivery");
    await mail.drainOutbox();
    assert.equal(calls, 2);
  });

  test("missing SMTP config stays retryable and sends once it is available", async () => {
    process.env.MAIL_RETRY_BASE_MS = "0";
    await db.updateProductPricing("thyme", { qtyAvailable: 4 });
    let calls = 0;
    mail.sendOrderConfirmation = async () => {
      calls += 1;
      if (calls === 1) return { skipped: true, reason: "SMTP not configured" };
      return { ok: true, messageId: "configured-later" };
    };
    const agent = request.agent(app);
    const form = await openBuy(agent, "thyme");
    const res = await postConfirm(agent, {
      _csrf: form.csrf,
      checkout_token: form.checkoutToken,
      mode: "buy_now",
      product_id: "thyme",
      email: "later@example.com",
    });
    assert.equal(res.status, 200);
    const orderId = orderIdOf(res.text);
    let box = await db.getMailOutboxByOrderId(orderId);
    assert.equal(box.status, "pending");
    assert.notEqual(box.status, "dead");
    await mail.drainOutbox();
    assert.equal(calls, 2);
    box = await db.getMailOutboxByOrderId(orderId);
    assert.equal(box.status, "sent");
    assert.equal(box.messageId, "configured-later");
  });
});
