/**
 * Checkout abuse guards. Uses sqlite (SQLITE_FILE) so the suite does not
 * need MySQL. Env is set before the app loads.
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, test, before, after, beforeEach } = require("node:test");
const request = require("supertest");

const sqliteFile = path.join(os.tmpdir(), `ocean-checkout-${process.pid}.sqlite`);

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
delete process.env.TRUST_PROXY;

const app = require("../app");
const db = require("../db");
const mail = require("../mail");

const sent = [];
mail.sendOrderConfirmation = async (payload) => {
  sent.push(payload);
  return { ok: true, messageId: `test-${sent.length}` };
};

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
  assert.match(raw, /HttpOnly/i);
  assert.match(raw, /SameSite=Lax/i);
  const value = decodeURIComponent(raw.split(";")[0].slice("ocean.sid=".length));
  assert.ok(value.startsWith("s:"), value);
  const body = value.slice(2);
  const dot = body.lastIndexOf(".");
  assert.ok(dot > 0);
  return body.slice(0, dot);
}

async function orderCount() {
  return (await db.listOrders()).length;
}

async function stock(productId) {
  const product = await db.getProduct(productId);
  return product.qtyAvailable;
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

describe("checkout abuse guards", { concurrency: false }, () => {
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
    process.env.ORDER_RATE_LIMIT_IP = "100";
    process.env.ORDER_RATE_LIMIT_EMAIL = "100";
    process.env.MAIL_RATE_LIMIT_IP = "100";
    process.env.MAIL_RATE_LIMIT_EMAIL = "100";
    await db.clearAbuseEvents();
    await db.resetIpCount();
  });

  test("session cookie is httpOnly and SameSite=Lax", async () => {
    const res = await request(app).get("/buy/basil");
    assert.equal(res.status, 200);
    sessionIdOf(res);
    assert.equal(checkoutTokenOf(res.text).length, 64);
    assert.doesNotMatch(String(res.headers["set-cookie"]), /;\s*Secure/i);
  });

  test("COOKIE_SECURE marks the cookie Secure on an HTTPS request", () => {
    const secureDb = path.join(os.tmpdir(), `ocean-secure-${process.pid}.sqlite`);
    fs.rmSync(secureDb, { force: true });
    const probe = spawnSync(
      process.execPath,
      [
        "-e",
        `
          const app = require("./app");
          const db = require("./db");
          (async () => {
            await app.ready();
            const server = app.listen(0, "127.0.0.1");
            await new Promise((resolve) => server.once("listening", resolve));
            const port = server.address().port;
            const res = await fetch("http://127.0.0.1:" + port + "/buy/basil", {
              headers: { "x-forwarded-proto": "https" },
            });
            const cookie = res.headers.get("set-cookie") || "";
            if (!/HttpOnly/i.test(cookie)) process.exit(2);
            if (!/SameSite=Lax/i.test(cookie)) process.exit(3);
            if (!/Secure/i.test(cookie)) {
              console.error(cookie);
              process.exit(4);
            }
            await db.closeDb();
            server.close();
            process.exit(0);
          })().catch((err) => {
            console.error(err);
            process.exit(1);
          });
        `,
      ],
      {
        cwd: path.join(__dirname, ".."),
        env: {
          ...process.env,
          COOKIE_SECURE: "true",
          TRUST_PROXY: "true",
          SQLITE_FILE: secureDb,
          ADMIN_PASSWORD: "test-admin-password",
          SESSION_SECRET: "test-session-secret",
          NODE_ENV: "test",
        },
        encoding: "utf8",
        timeout: 20000,
      }
    );
    fs.rmSync(secureDb, { force: true });
    assert.equal(
      probe.status,
      0,
      `secure-cookie probe failed (${probe.status})\n${probe.stdout}\n${probe.stderr}`
    );
  });

  test("direct POST without a session or CSRF does not order or send mail", async () => {
    const beforeOrders = await orderCount();
    const beforeStock = await stock("basil");
    const res = await request(app).post("/confirm").type("form").send({
      mode: "buy_now",
      product_id: "basil",
      email: "wneigtwv@formtests.info",
    });
    assert.equal(res.status, 403);
    assert.equal(await orderCount(), beforeOrders);
    assert.equal(await stock("basil"), beforeStock);
    assert.equal(sent.length, 0);
  });

  test("a session without a CSRF token cannot check out", async () => {
    const agent = request.agent(app);
    await agent.get("/buy/basil");
    const beforeOrders = await orderCount();
    const res = await postConfirm(agent, {
      mode: "buy_now",
      product_id: "basil",
      email: "nobody@example.com",
    });
    assert.equal(res.status, 403);
    assert.equal(await orderCount(), beforeOrders);
    assert.equal(sent.length, 0);
  });

  test("valid buy-now checkout sends one mail and a replay does not repeat it", async () => {
    await db.updateProductPricing("basil", { qtyAvailable: 5 });
    const agent = request.agent(app);
    const form = await openBuy(agent, "basil");
    const body = {
      _csrf: form.csrf,
      checkout_token: form.checkoutToken,
      mode: "buy_now",
      product_id: "basil",
      email: "buyer@example.com",
      phone: "555-0100",
    };
    const first = await postConfirm(agent, body);
    assert.equal(first.status, 200);
    const orderId = orderIdOf(first.text);
    assert.equal(await stock("basil"), 4);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].order.order_id_display, orderId);
    assert.equal(sent[0].order.email, "buyer@example.com");

    const again = await postConfirm(agent, body);
    assert.equal(again.status, 200);
    assert.equal(orderIdOf(again.text), orderId);
    assert.equal(await stock("basil"), 4);
    assert.equal(sent.length, 1);
    const basilOrders = (await db.listOrders()).filter((order) =>
      String(order.product_id).includes("basil")
    );
    const thisOrder = basilOrders.filter((order) => order.order_id_display === orderId);
    assert.equal(thisOrder.length, 1);
  });

  test("a checkout token from another session is rejected", async () => {
    await db.updateProductPricing("basil", { qtyAvailable: 4 });
    const owner = request.agent(app);
    const thief = request.agent(app);
    const form = await openBuy(owner, "basil");
    const thiefPage = await thief.get("/");
    const beforeOrders = await orderCount();
    const res = await postConfirm(thief, {
      _csrf: csrfOf(thiefPage.text),
      checkout_token: form.checkoutToken,
      mode: "buy_now",
      product_id: "basil",
      email: "thief@example.com",
    });
    assert.equal(res.status, 403);
    assert.equal(await orderCount(), beforeOrders);
    assert.equal(await stock("basil"), 4);
    assert.equal(sent.length, 0);
  });

  test("deleting the server session invalidates the cookie", async () => {
    await db.updateProductPricing("basil", { qtyAvailable: 4 });
    const agent = request.agent(app);
    const form = await openBuy(agent, "basil");
    const sid = sessionIdOf(form.page);
    await db.destroySession(sid);
    const beforeOrders = await orderCount();
    const res = await postConfirm(agent, {
      _csrf: form.csrf,
      checkout_token: form.checkoutToken,
      mode: "buy_now",
      product_id: "basil",
      email: "gone@example.com",
    });
    assert.equal(res.status, 403);
    assert.equal(await orderCount(), beforeOrders);
    assert.equal(sent.length, 0);
  });

  test("zero stock is rejected and does not send mail", async () => {
    await db.updateProductPricing("basil", { qtyAvailable: 0 });
    const agent = request.agent(app);
    const form = await openBuy(agent, "basil");
    const beforeOrders = await orderCount();
    const res = await postConfirm(agent, {
      _csrf: form.csrf,
      checkout_token: form.checkoutToken,
      mode: "buy_now",
      product_id: "basil",
      email: "zero@example.com",
    });
    assert.equal(res.status, 409);
    assert.match(res.text, /out of stock/i);
    assert.equal(await stock("basil"), 0);
    assert.equal(await orderCount(), beforeOrders);
    assert.equal(sent.length, 0);
  });

  test("swapping the product id does not order the other item", async () => {
    await db.updateProductPricing("basil", { qtyAvailable: 3 });
    await db.updateProductPricing("thyme", { qtyAvailable: 3 });
    const agent = request.agent(app);
    const form = await openBuy(agent, "basil");
    const beforeOrders = await orderCount();
    const swapped = await postConfirm(agent, {
      _csrf: form.csrf,
      checkout_token: form.checkoutToken,
      mode: "buy_now",
      product_id: "thyme",
      email: "swap@example.com",
    });
    assert.equal(swapped.status, 403);
    assert.equal(await stock("basil"), 3);
    assert.equal(await stock("thyme"), 3);
    assert.equal(await orderCount(), beforeOrders);

    const ok = await postConfirm(agent, {
      _csrf: form.csrf,
      checkout_token: form.checkoutToken,
      mode: "buy_now",
      product_id: "basil",
      email: "swap@example.com",
    });
    assert.equal(ok.status, 200);
    assert.equal(await stock("basil"), 2);
    assert.equal(await stock("thyme"), 3);
    assert.equal(sent.length, 1);
  });

  test("spoofed X-Forwarded-For does not open a new per-IP budget", async () => {
    process.env.ORDER_RATE_LIMIT_IP = "1";
    await db.updateProductPricing("rosemary", { qtyAvailable: 5 });
    const first = request.agent(app);
    const form = await openBuy(first, "rosemary");
    const ok = await postConfirm(first, {
      _csrf: form.csrf,
      checkout_token: form.checkoutToken,
      mode: "buy_now",
      product_id: "rosemary",
      email: "one@example.com",
    });
    assert.equal(ok.status, 200);
    assert.equal(sent.length, 1);

    const second = request.agent(app);
    const again = await openBuy(second, "rosemary");
    const blocked = await second
      .post("/confirm")
      .set("X-Forwarded-For", "203.0.113.50")
      .type("form")
      .send({
        _csrf: again.csrf,
        checkout_token: again.checkoutToken,
        mode: "buy_now",
        product_id: "rosemary",
        email: "two@example.com",
      });
    assert.equal(blocked.status, 429);
    assert.equal(await stock("rosemary"), 4);
    assert.equal(sent.length, 1);
  });

  test("per-email order limit and a separate mail limit", async () => {
    process.env.ORDER_RATE_LIMIT_EMAIL = "1";
    process.env.ORDER_RATE_LIMIT_IP = "100";
    await db.updateProductPricing("thyme", { qtyAvailable: 5 });
    const agent = request.agent(app);
    const firstForm = await openBuy(agent, "thyme");
    const first = await postConfirm(agent, {
      _csrf: firstForm.csrf,
      checkout_token: firstForm.checkoutToken,
      mode: "buy_now",
      product_id: "thyme",
      email: "repeat@example.com",
    });
    assert.equal(first.status, 200);
    const secondForm = await openBuy(agent, "thyme");
    const second = await postConfirm(agent, {
      _csrf: secondForm.csrf,
      checkout_token: secondForm.checkoutToken,
      mode: "buy_now",
      product_id: "thyme",
      email: "Repeat@example.com",
    });
    assert.equal(second.status, 429);
    assert.equal(await stock("thyme"), 4);
    assert.equal(sent.length, 1);

    await db.clearAbuseEvents();
    process.env.ORDER_RATE_LIMIT_EMAIL = "100";
    process.env.MAIL_RATE_LIMIT_EMAIL = "1";
    sent.length = 0;
    const mailA = await openBuy(agent, "thyme");
    const createdA = await postConfirm(agent, {
      _csrf: mailA.csrf,
      checkout_token: mailA.checkoutToken,
      mode: "buy_now",
      product_id: "thyme",
      email: "mail-limit@example.com",
    });
    assert.equal(createdA.status, 200);
    const mailB = await openBuy(agent, "thyme");
    const createdB = await postConfirm(agent, {
      _csrf: mailB.csrf,
      checkout_token: mailB.checkoutToken,
      mode: "buy_now",
      product_id: "thyme",
      email: "mail-limit@example.com",
    });
    assert.equal(createdB.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(await stock("thyme"), 2);
  });

  test("concurrent last-item checkouts cannot oversell, and ship does not decrement again", async () => {
    await db.updateProductPricing("purple-coneflower", { qtyAvailable: 1 });
    const a = request.agent(app);
    const b = request.agent(app);
    const formA = await openBuy(a, "purple-coneflower");
    const formB = await openBuy(b, "purple-coneflower");
    const [resA, resB] = await Promise.all([
      postConfirm(a, {
        _csrf: formA.csrf,
        checkout_token: formA.checkoutToken,
        mode: "buy_now",
        product_id: "purple-coneflower",
        email: "race-a@example.com",
      }),
      postConfirm(b, {
        _csrf: formB.csrf,
        checkout_token: formB.checkoutToken,
        mode: "buy_now",
        product_id: "purple-coneflower",
        email: "race-b@example.com",
      }),
    ]);
    const statuses = [resA.status, resB.status].sort((x, y) => x - y);
    assert.deepEqual(statuses, [200, 409]);
    assert.equal(await stock("purple-coneflower"), 0);
    assert.equal(sent.length, 1);
    const winner = resA.status === 200 ? resA : resB;
    const orderId = orderIdOf(winner.text);
    const shipped = await db.shipOrder({
      orderId,
      trackingNumber: "1Z-RACE",
      carrier: "UPS",
    });
    assert.equal(shipped.stockDecremented, false);
    assert.equal(shipped.alreadyShipped, false);
    assert.equal(await stock("purple-coneflower"), 0);
    const again = await db.shipOrder({
      orderId,
      trackingNumber: "1Z-RACE",
      carrier: "UPS",
    });
    assert.equal(again.alreadyShipped, true);
    assert.equal(await stock("purple-coneflower"), 0);
  });

  test("legacy unreserved orders still decrement once at ship and block a second sale", async () => {
    await db.updateProductPricing("rosemary", { qtyAvailable: 2 });
    const legacyId = await db.insertUnreservedOrder({
      productId: "rosemary",
      quantity: 1,
      productName: "rosemary",
      email: "legacy@example.com",
      ipAddress: "198.51.100.10",
    });
    assert.equal(await stock("rosemary"), 2);

    const agent = request.agent(app);
    const blockedForm = await openBuy(agent, "rosemary");
    // Two on hand, one already promised by the unshipped legacy order.
    // A quantity of 2 must be rejected. Buy-now is quantity 1 and can proceed.
    await db.updateProductPricing("rosemary", { qtyAvailable: 1 });
    const denied = await postConfirm(agent, {
      _csrf: blockedForm.csrf,
      checkout_token: blockedForm.checkoutToken,
      mode: "buy_now",
      product_id: "rosemary",
      email: "late@example.com",
    });
    assert.equal(denied.status, 409);
    assert.equal(await stock("rosemary"), 1);
    assert.equal(sent.length, 0);

    const shipped = await db.shipOrder({
      orderId: legacyId,
      trackingNumber: "1Z-LEGACY",
      carrier: "USPS",
    });
    assert.equal(shipped.stockDecremented, true);
    assert.equal(await stock("rosemary"), 0);
    const secondShip = await db.shipOrder({
      orderId: legacyId,
      trackingNumber: "1Z-LEGACY",
      carrier: "USPS",
    });
    assert.equal(secondShip.alreadyShipped, true);
    assert.equal(await stock("rosemary"), 0);

    const after = request.agent(app);
    const form = await openBuy(after, "rosemary");
    const res = await postConfirm(after, {
      _csrf: form.csrf,
      checkout_token: form.checkoutToken,
      mode: "buy_now",
      product_id: "rosemary",
      email: "after-ship@example.com",
    });
    assert.equal(res.status, 409);
    assert.equal(await stock("rosemary"), 0);
  });

  test("cart checkout holds stock once and a replay does not send a second mail", async () => {
    await db.updateProductPricing("thyme", { qtyAvailable: 6 });
    const agent = request.agent(app);
    const home = await agent.get("/");
    await agent.post("/cart/add").type("form").send({
      _csrf: csrfOf(home.text),
      product_id: "thyme",
      redirect: "cart",
    });
    const page = await agent.get("/cart/checkout");
    assert.equal(page.status, 200);
    const res = await postConfirm(agent, {
      _csrf: csrfOf(page.text),
      checkout_token: checkoutTokenOf(page.text),
      mode: "cart",
      email: "cart@example.com",
    });
    assert.equal(res.status, 200);
    const orderId = orderIdOf(res.text);
    assert.equal(await stock("thyme"), 5);
    assert.equal(sent.length, 1);
    const replay = await postConfirm(agent, {
      _csrf: csrfOf(page.text),
      checkout_token: checkoutTokenOf(page.text),
      mode: "cart",
      email: "cart@example.com",
    });
    assert.equal(replay.status, 200);
    assert.equal(orderIdOf(replay.text), orderId);
    assert.equal(await stock("thyme"), 5);
    assert.equal(sent.length, 1);
    const shipped = await db.shipOrder({
      orderId,
      trackingNumber: "1Z-CART",
      carrier: "UPS",
    });
    assert.equal(shipped.stockDecremented, false);
    assert.equal(await stock("thyme"), 5);
  });
});
