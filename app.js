/**
 * Ocean Market — basic webstore (Node.js / Express).
 *
 * Run:
 *   npm install
 *   # ensure MySQL is running and ocean is initialized (see README)
 *   npm start
 *
 * Then open http://127.0.0.1:3000
 * Admin: http://127.0.0.1:3000/admin?key=ocean-admin-2024
 */

const fs = require("fs");
const path = require("path");

// Always load .env next to this file (PM2/systemd cwd can differ after reboot)
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const session = require("express-session");
const multer = require("multer");
const db = require("./db");
const cart = require("./cart");
const mail = require("./mail");
const {
  STORE_NAME,
  STORE_TAGLINE,
  MAX_ORDERS_PER_IP,
  PORT,
  HOST,
  ADMIN_KEY,
  SITE_URL,
  PLACEHOLDER_IMAGE,
  formatPrice,
  slugify,
  buildSeo,
  getSitemapEntries,
} = require("./config");

const app = express();

// Correct client IPs / secure cookies when reverse-proxied (nginx, Caddy, etc.)
if (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

const uploadsDir = path.join(__dirname, "public", "uploads", "products");
fs.mkdirSync(uploadsDir, { recursive: true });

// Image uploads for product photos (admin only)
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
      const safeExt = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)
        ? ext
        : ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed (jpeg, png, gif, webp)."));
    }
  },
});

// Views & static assets
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false }));

const isProd = process.env.NODE_ENV === "production";

app.use(
  session({
    name: "ocean.sid",
    secret: process.env.SESSION_SECRET || "change-me-ocean-market-session",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      // Set cookie Secure flag when served over HTTPS (requires TRUST_PROXY behind TLS)
      secure: process.env.COOKIE_SECURE === "1" || process.env.COOKIE_SECURE === "true",
    },
  })
);

app.use((req, res, next) => {
  res.locals.storeName = STORE_NAME;
  res.locals.storeTagline = STORE_TAGLINE;
  res.locals.maxOrdersPerIp = MAX_ORDERS_PER_IP;
  res.locals.formatPrice = formatPrice;
  res.locals.flashError = null;
  res.locals.cartCount = cart.cartCount(cart.getCart(req));
  // Defaults so success/confirm templates never hit "is not defined"
  res.locals.email = null;
  res.locals.phone = null;
  // Site-wide SEO defaults (routes override with buildSeo("pageKey"))
  res.locals.seo = buildSeo();
  next();
});

// ---------------------------------------------------------------------------
// SEO: robots.txt + sitemap.xml
// ---------------------------------------------------------------------------

app.get("/robots.txt", (_req, res) => {
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /admin/",
    "Disallow: /cart",
    "Disallow: /cart/",
    "Disallow: /buy/",
    "Disallow: /order",
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    "",
  ].join("\n");
  res.type("text/plain").send(body);
});

app.get("/sitemap.xml", (_req, res) => {
  const entries = getSitemapEntries();
  const urls = entries
    .map(
      (e) => `  <url>
    <loc>${escapeXml(e.loc)}</loc>
    <changefreq>${escapeXml(e.changefreq)}</changefreq>
    <priority>${escapeXml(e.priority)}</priority>
  </url>`
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  res.type("application/xml").send(xml);
});

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  let ip =
    typeof forwarded === "string" && forwarded.length > 0
      ? forwarded.split(",")[0].trim()
      : req.socket.remoteAddress || "unknown";

  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  return ip;
}

function adminKeyFrom(req) {
  return String(req.query.key || req.body.key || "").trim();
}

function requireAdmin(req, res) {
  if (adminKeyFrom(req) !== ADMIN_KEY) {
    res.status(401).render("admin_login", {
      invalidKey: true,
      seo: buildSeo("admin"),
    });
    return false;
  }
  return true;
}

/**
 * Build an admin URL, optionally targeting a section tab via hash.
 * Examples: adminUrl() · adminUrl({ hash: "orders" })
 */
function adminUrl({ hash = "orders" } = {}) {
  let url = `/admin?key=${encodeURIComponent(ADMIN_KEY)}`;
  if (hash) url += `#${hash}`;
  return url;
}

function publicUploadPath(filename) {
  return `/uploads/products/${filename}`;
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

app.get("/", async (req, res, next) => {
  try {
    res.render("index", {
      products: await db.listProducts(),
      seo: buildSeo("home"),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

app.get("/cart", async (req, res, next) => {
  try {
    const items = await cart.getCartItems(cart.getCart(req));
    res.render("cart", {
      items,
      total: cart.cartTotal(items),
      seo: buildSeo("cart"),
    });
  } catch (err) {
    next(err);
  }
});

app.post("/cart/add", async (req, res, next) => {
  try {
    const productId = String(req.body.product_id || "").trim();
    const product = await db.getProduct(productId);
    const wantsJson =
      req.xhr ||
      (req.headers.accept || "").includes("application/json") ||
      req.body.ajax === "1";

    if (!product) {
      if (wantsJson) {
        return res.status(404).json({ ok: false, error: "Product not found" });
      }
      return res.status(404).render("404", { seo: buildSeo("notFound") });
    }

    await cart.addToCart(req, productId, 1);
    const cartCount = cart.cartCount(cart.getCart(req));

    // AJAX add-to-cart: stay on page (no scroll jump)
    if (wantsJson) {
      return res.json({ ok: true, cartCount, productId: product.id });
    }

    const redirectTo = req.body.redirect || "/";
    if (redirectTo === "cart") {
      return res.redirect("/cart");
    }
    return res.redirect("/");
  } catch (err) {
    next(err);
  }
});

app.post("/cart/update", async (req, res, next) => {
  try {
    const productId = String(req.body.product_id || "").trim();
    const quantity = req.body.quantity;
    await cart.setCartQuantity(req, productId, quantity);
    return res.redirect("/cart");
  } catch (err) {
    next(err);
  }
});

app.post("/cart/remove", (req, res) => {
  const productId = String(req.body.product_id || "").trim();
  cart.removeFromCart(req, productId);
  return res.redirect("/cart");
});

app.get("/cart/checkout", async (req, res, next) => {
  try {
    const items = await cart.getCartItems(cart.getCart(req));
    if (items.length === 0) {
      return res.redirect("/cart");
    }

    const ip = clientIp(req);
    if (!(await db.canPlaceOrder(ip))) {
      return res.status(429).render("limit", {
        product: null,
        items,
        seo: buildSeo("limit"),
      });
    }

    res.render("confirm", {
      mode: "cart",
      product: null,
      items,
      total: cart.cartTotal(items),
      seo: buildSeo("confirm", { title: "Confirm cart order" }),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Buy Now + confirm
// ---------------------------------------------------------------------------

app.get("/buy/:productId", async (req, res, next) => {
  try {
    const product = await db.getProduct(req.params.productId);
    if (!product) {
      return res.status(404).render("404", { seo: buildSeo("notFound") });
    }

    const ip = clientIp(req);
    if (!(await db.canPlaceOrder(ip))) {
      return res.status(429).render("limit", {
        product,
        items: null,
        seo: buildSeo("limit"),
      });
    }

    res.render("confirm", {
      mode: "buy_now",
      product,
      items: [{ product, quantity: 1, lineTotal: product.price }],
      total: product.price,
      seo: buildSeo("confirm", {
        title: `Confirm order — ${product.name}`,
        description: product.description
          ? String(product.description).slice(0, 160)
          : undefined,
        image: product.image || undefined,
      }),
    });
  } catch (err) {
    next(err);
  }
});

app.post("/confirm", async (req, res, next) => {
  try {
    const mode = String(req.body.mode || "buy_now").trim();
    const email = String(req.body.email || "").trim();
    const phone = String(req.body.phone || "").trim();
    const ip = clientIp(req);

    let items = [];

    if (mode === "cart") {
      items = await cart.getCartItems(cart.getCart(req));
      if (items.length === 0) {
        return res.redirect("/cart");
      }
    } else {
      const productId = String(req.body.product_id || "").trim();
      const product = await db.getProduct(productId);
      if (!product) {
        return res.status(404).render("404", { seo: buildSeo("notFound") });
      }
      items = [{ product, quantity: 1, lineTotal: product.price }];
    }

    const { productId, productName } = cart.orderFieldsFromItems(items);
    const total = cart.cartTotal(items);

    try {
      const orderId = await db.createOrder({
        productId,
        productName,
        email: email || null,
        phone: phone || null,
        ipAddress: ip,
      });

      if (mode === "cart") {
        cart.clearCart(req);
      }

      // Email HTML receipt to EMAIL_TO (non-blocking for the customer response)
      const order = await db.getOrder(orderId);
      if (order) {
        const lineItems = await db.getOrderLineItems(order);
        const subtotal = db.orderSubtotal(lineItems);
        const hasPrices = lineItems.every((item) => item.unitPrice !== null);
        mail
          .sendOrderConfirmation({ order, lineItems, subtotal, hasPrices })
          .catch((err) => {
            console.error("[mail] Unexpected error sending confirmation:", err);
          });
      }

      return res.render("success", {
        orderId,
        email: email || null,
        phone: phone || null,
        items,
        total,
        product: items.length === 1 ? items[0].product : null,
        seo: buildSeo("success"),
      });
    } catch (err) {
      return res.status(429).render("limit", {
        product: items.length === 1 ? items[0].product : null,
        items,
        flashError: err.message,
        seo: buildSeo("limit"),
      });
    }
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

app.get("/admin", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;

    res.render("admin", {
      orders: await db.listOrders(),
      ipCounts: await db.listIpCounts(),
      products: await db.listProducts(),
      adminKey: ADMIN_KEY,
      seo: buildSeo("admin"),
    });
  } catch (err) {
    next(err);
  }
});

app.post("/admin", (req, res) => {
  const provided = String(req.body.key || "").trim();
  if (provided !== ADMIN_KEY) {
    return res.status(401).render("admin_login", {
      invalidKey: true,
      seo: buildSeo("admin"),
    });
  }
  return res.redirect(adminUrl());
});

/** Reset one IP order counter (or all if ip is empty / "all") */
app.post("/admin/ip-counts/reset", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;

    try {
      const ip = String(
        (req.body && req.body.ip_address) || req.query.ip_address || ""
      ).trim();

      if (!ip || ip.toLowerCase() === "all") {
        await db.resetIpCount();
      } else {
        await db.resetIpCount(ip);
      }
    } catch (err) {
      console.error("IP counter reset failed:", err);
    }

    return res.redirect(adminUrl({ hash: "ip-counts" }));
  } catch (err) {
    next(err);
  }
});

/** Receipt / invoice view for a single order */
app.get("/admin/orders/:orderId", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;

    const order = await db.getOrder(req.params.orderId);
    if (!order) {
      return res.status(404).render("404", { seo: buildSeo("notFound") });
    }

    const lineItems = await db.getOrderLineItems(order);
    const subtotal = db.orderSubtotal(lineItems);
    const hasPrices = lineItems.every((item) => item.unitPrice !== null);

    res.render("admin_order", {
      order,
      lineItems,
      subtotal,
      hasPrices,
      adminKey: ADMIN_KEY,
      seo: buildSeo("admin", {
        title: `Receipt ${order.order_id_display} — Admin`,
      }),
    });
  } catch (err) {
    next(err);
  }
});

/** Add a new product (optional photo upload) */
app.post("/admin/products", (req, res) => {
  upload.single("photo")(req, res, async (err) => {
    try {
      if (!requireAdmin(req, res)) return;

      if (err) {
        return res.redirect(adminUrl({ hash: "add-product" }));
      }

      const name = String(req.body.name || "").trim();
      const description = String(req.body.description || "").trim();
      const price = Number(req.body.price);
      const qtyAvailable = Number(req.body.qty_available);
      let id = String(req.body.id || "").trim() || slugify(name);

      if (
        !name ||
        !Number.isFinite(price) ||
        price < 0 ||
        !Number.isFinite(qtyAvailable) ||
        qtyAvailable < 0 ||
        !id
      ) {
        return res.redirect(adminUrl({ hash: "add-product" }));
      }

      // Ensure unique id
      if (await db.productIdExists(id)) {
        let n = 2;
        while (await db.productIdExists(`${id}-${n}`)) n += 1;
        id = `${id}-${n}`;
      }

      const image = req.file
        ? publicUploadPath(req.file.filename)
        : PLACEHOLDER_IMAGE;

      try {
        await db.createProduct({
          id,
          name,
          price,
          description,
          image,
          qtyAvailable: Math.floor(qtyAvailable),
        });
        return res.redirect(adminUrl({ hash: "products" }));
      } catch (_e) {
        return res.redirect(adminUrl({ hash: "add-product" }));
      }
    } catch (e) {
      console.error("Add product failed:", e);
      return res.redirect(adminUrl({ hash: "add-product" }));
    }
  });
});

/** Update price and quantity available */
app.post("/admin/products/:productId/update", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;

    const productId = req.params.productId;
    const product = await db.getProduct(productId);
    if (!product) {
      return res.redirect(adminUrl({ hash: "products" }));
    }

    try {
      await db.updateProductPricing(productId, {
        price: req.body.price,
        qtyAvailable: req.body.qty_available,
      });
    } catch (_e) {
      // Stay on products tab; no toast
    }
    return res.redirect(adminUrl({ hash: "products" }));
  } catch (err) {
    next(err);
  }
});

/** Upload / replace a product photo */
app.post("/admin/products/:productId/photo", (req, res) => {
  upload.single("photo")(req, res, async (err) => {
    try {
      if (!requireAdmin(req, res)) return;

      if (err) {
        return res.redirect(adminUrl({ hash: "products" }));
      }

      const productId = req.params.productId;
      const product = await db.getProduct(productId);
      if (!product || !req.file) {
        return res.redirect(adminUrl({ hash: "products" }));
      }

      const image = publicUploadPath(req.file.filename);
      await db.updateProductImage(productId, image);
      return res.redirect(adminUrl({ hash: "products" }));
    } catch (e) {
      console.error("Photo upload failed:", e);
      return res.redirect(adminUrl({ hash: "products" }));
    }
  });
});

app.use((req, res) => {
  res.status(404).render("404", { seo: buildSeo("notFound") });
});

// Basic error handler for async route failures (e.g. DB down)
app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(500).send("Internal Server Error");
});

/**
 * Wait for MySQL after reboot (PM2 often starts before mysqld is ready).
 * Retries with backoff, then exits so PM2 can try again.
 */
async function initDbWithRetry(options = {}) {
  const maxAttempts = Number(options.maxAttempts) || 30;
  const baseDelayMs = Number(options.baseDelayMs) || 2000;
  const maxDelayMs = Number(options.maxDelayMs) || 15000;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await db.initDb();
      if (attempt > 1) {
        console.log(`[db] Connected to MySQL on attempt ${attempt}`);
      }
      return;
    } catch (err) {
      lastErr = err;
      const delay = Math.min(baseDelayMs * attempt, maxDelayMs);
      console.error(
        `[db] MySQL not ready (attempt ${attempt}/${maxAttempts}): ${
          err.message || err
        }`
      );
      if (attempt < maxAttempts) {
        console.error(`[db] Retrying in ${Math.round(delay / 1000)}s…`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastErr;
}

async function start() {
  if (
    isProd &&
    (!process.env.SESSION_SECRET ||
      process.env.SESSION_SECRET === "change-me-ocean-market-session")
  ) {
    console.warn(
      "[warn] Set a strong SESSION_SECRET in .env for production."
    );
  }

  console.log(
    `[boot] cwd=${process.cwd()} __dirname=${__dirname} PORT=${PORT} HOST=${HOST}`
  );

  try {
    await initDbWithRetry();
  } catch (err) {
    console.error(
      "[fatal] Could not connect to MySQL or initialize schema.",
      "Check MYSQL_* in .env, that MySQL is running, and that the database exists."
    );
    console.error(err.message || err);
    process.exit(1);
  }

  app.listen(PORT, HOST, () => {
    const displayHost = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
    console.log(
      `${STORE_NAME} running at http://${displayHost}:${PORT} (bind ${HOST})`
    );
    console.log(
      `Admin: http://${displayHost}:${PORT}/admin?key=${ADMIN_KEY}`
    );
  });
}

if (require.main === module) {
  start();
}

module.exports = app;
