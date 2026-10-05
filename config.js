/**
 * Easy-to-edit configuration for the webstore.
 * Products live in MySQL (database `ocean` by default) after first run
 * (seeded from DEFAULT_PRODUCTS). Manage products and photos from /admin.
 *
 * Initialize the database with: npm run db:init  (uses MYSQL_* from .env)
 * Connection credentials: MYSQL_* in .env
 */

// ---------------------------------------------------------------------------
// Store branding
// ---------------------------------------------------------------------------
const STORE_NAME = "Ocean Market";
const STORE_TAGLINE = "Live reef. Honest packing. Overnight.";

// ---------------------------------------------------------------------------
// Order limits
// ---------------------------------------------------------------------------
/** Maximum confirmed orders allowed per client IP address */
const MAX_ORDERS_PER_IP = 20;

// ---------------------------------------------------------------------------
// Database & server
// ---------------------------------------------------------------------------
/**
 * MySQL connection settings (overridable via .env).
 * Defaults match scripts/init-ocean.sql local development setup.
 *
 * MYSQL_SSL=true enables TLS. Provider cert chains (Aiven and similar) are
 * accepted by default because those CAs are not in the system store.
 * Tighten later with MYSQL_SSL_CA and/or MYSQL_SSL_REJECT_UNAUTHORIZED=true.
 * Local 127.0.0.1 setups usually leave MYSQL_SSL false/off.
 */
function getMysqlConfig() {
  const sslEnabled =
    process.env.MYSQL_SSL === "1" ||
    process.env.MYSQL_SSL === "true" ||
    process.env.MYSQL_SSL === "TRUE";

  let ssl;
  if (sslEnabled) {
    // Default: encrypt, but allow self-signed / private-CA chains.
    // Opt into verification with MYSQL_SSL_REJECT_UNAUTHORIZED=true or a CA file.
    const forceVerify =
      process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === "1" ||
      process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === "true" ||
      process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === "TRUE";
    ssl = {
      rejectUnauthorized: forceVerify,
    };
    if (process.env.MYSQL_SSL_CA) {
      const fs = require("fs");
      ssl.ca = fs.readFileSync(process.env.MYSQL_SSL_CA);
      if (
        process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== "0" &&
        process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== "false" &&
        process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== "FALSE"
      ) {
        ssl.rejectUnauthorized = true;
      }
    }
  }

  return {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "ocean",
    password: process.env.MYSQL_PASSWORD || "ocean_pass",
    database: process.env.MYSQL_DATABASE || "ocean",
    ssl,
  };
}

/** HTTP port */
const PORT = process.env.PORT || 3000;

/**
 * Bind address. Use 127.0.0.1 behind nginx on the same machine,
 * or 0.0.0.0 to accept connections from outside the host.
 */
const HOST = process.env.HOST || "0.0.0.0";

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
/**
 * Admin login credentials come from .env — never from the URL.
 *
 *   ADMIN_PASSWORD        plaintext password (hashed with bcrypt at boot)
 *   ADMIN_PASSWORD_HASH   bcrypt hash (preferred; wins if both are set)
 *
 * One of these is required. There is no built-in default password.
 * Generate a hash: npm run admin:hash -- 'your-password'
 */
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "").trim();
const ADMIN_PASSWORD_HASH = String(process.env.ADMIN_PASSWORD_HASH || "").trim();

// ---------------------------------------------------------------------------
// SEO (search engines & social sharing)
// ---------------------------------------------------------------------------
/**
 * Public site origin for canonical URLs, Open Graph, sitemap, and robots.txt.
 * Set SITE_URL in .env to your real production domain (no trailing slash), e.g.:
 *   SITE_URL=https://ocean-market.example.com
 */
const SITE_URL = String(process.env.SITE_URL || `http://127.0.0.1:${PORT}`).replace(
  /\/$/,
  ""
);

/**
 * Central SEO data. Edit `SEO.defaults` for site-wide values and `SEO.pages`
 * for per-route titles, descriptions, and index rules.
 *
 * See README → "SEO" for a full guide.
 */
const SEO = {
  /** Site-wide fallbacks when a page omits a field */
  defaults: {
    title: `${STORE_NAME} — ${STORE_TAGLINE}`,
    description:
      "Shop live corals, aquatic plants, reef livestock, and aquarium supplies at Ocean Market.",
    keywords:
      "ocean market, reef store, live coral, aquatic plants, clownfish, LPS, SPS, zoanthids, aquarium supplies",
    /**
     * Default share image (absolute URL or site path starting with /).
     * Leave empty to omit og:image / twitter:image until you add one.
     * Example: "/uploads/products/your-hero.webp"
     * or "https://cdn.example.com/og-ocean-market.jpg"
     */
    image: "",
    robots: "index, follow",
    type: "website",
  },

  /** Optional X/Twitter @handle without the @ (omit twitter:site if empty) */
  twitterSite: "",

  /** Open Graph locale */
  locale: "en_US",

  /**
   * Per-page SEO. Keys match what app.js passes to buildSeo("…").
   *
   * Fields:
   *   title, description, keywords, image, robots, type  — meta tags
   *   path        — used for canonical URL + sitemap (required if sitemap)
   *   sitemap     — set false to exclude from /sitemap.xml (default true if path set)
   *   changefreq  — sitemap hint: always|hourly|daily|weekly|monthly|yearly|never
   *   priority    — sitemap priority 0.0–1.0 as a string
   */
  pages: {
    home: {
      title: `${STORE_NAME} — Inventory`,
      description:
        "Browse live aquatic plants, soft coral, LPS, SPS, zoanthids, anemones, livestock, and reef supplies.",
      keywords:
        "buy live coral, aquatic plants, reef livestock, aquarium supplies, zoanthids, anemones",
      path: "/",
      changefreq: "daily",
      priority: "1.0",
    },
    cart: {
      title: `Your Cart — ${STORE_NAME}`,
      description:
        "Review items in your Ocean Market cart and proceed to checkout.",
      robots: "noindex, follow",
      path: "/cart",
      sitemap: false,
    },
    confirm: {
      title: `Confirm order — ${STORE_NAME}`,
      description: "Confirm your Ocean Market order and optionally leave contact details.",
      robots: "noindex, nofollow",
      path: "/cart/checkout",
      sitemap: false,
    },
    success: {
      title: `Order placed — ${STORE_NAME}`,
      description: "Your Ocean Market order was placed successfully.",
      robots: "noindex, nofollow",
      sitemap: false,
    },
    limit: {
      title: `Order limit reached — ${STORE_NAME}`,
      description: "This address has reached the maximum number of orders allowed.",
      robots: "noindex, nofollow",
      sitemap: false,
    },
    notFound: {
      title: `Page not found — ${STORE_NAME}`,
      description: "The page or product you requested could not be found.",
      robots: "noindex, nofollow",
      sitemap: false,
    },
    login: {
      title: `Sign in — ${STORE_NAME}`,
      description: "Sign in to your Ocean Market account.",
      robots: "noindex, follow",
      path: "/login",
      sitemap: false,
    },
    register: {
      title: `Create account — ${STORE_NAME}`,
      description: "Register for an Ocean Market account with your email.",
      robots: "noindex, follow",
      path: "/register",
      sitemap: false,
    },
    about: {
      title: `About — ${STORE_NAME}`,
      description: "About Ocean Market, a reef livestock and plant shop.",
      path: "/about",
      changefreq: "monthly",
      priority: "0.4",
    },
    contact: {
      title: `Contact — ${STORE_NAME}`,
      description: "Contact Ocean Market.",
      path: "/contact",
      changefreq: "monthly",
      priority: "0.4",
    },
    shipping: {
      title: `Shipping — ${STORE_NAME}`,
      description: "Live arrival and shipping details for Ocean Market livestock.",
      path: "/shipping",
      changefreq: "monthly",
      priority: "0.3",
    },
    returns: {
      title: `Returns — ${STORE_NAME}`,
      description: "Returns and livestock guarantee for Ocean Market.",
      path: "/returns",
      changefreq: "monthly",
      priority: "0.3",
    },
    care: {
      title: `Care guides — ${STORE_NAME}`,
      description: "Care guides for plants, corals, and reef livestock.",
      path: "/care",
      changefreq: "weekly",
      priority: "0.5",
    },
    admin: {
      title: `Admin — ${STORE_NAME}`,
      description: "Ocean Market administration.",
      robots: "noindex, nofollow",
      sitemap: false,
    },
  },
};

/**
 * Resolve an image path to an absolute URL for Open Graph / Twitter cards.
 * Accepts full http(s) URLs or site-relative paths (/…).
 */
function absoluteUrl(urlOrPath) {
  if (!urlOrPath) return "";
  const s = String(urlOrPath).trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  const pathPart = s.startsWith("/") ? s : `/${s}`;
  return `${SITE_URL}${pathPart}`;
}

/**
 * Build the SEO object passed to EJS templates (and used by the layout head).
 *
 * @param {string} [pageKey] - Key under SEO.pages (e.g. "home", "cart")
 * @param {object} [overrides] - Optional per-request overrides (title, description, …)
 * @returns {object} Flat SEO fields for the layout
 */
function buildSeo(pageKey, overrides = {}) {
  const page = (pageKey && SEO.pages[pageKey]) || {};
  const d = SEO.defaults;
  const o = overrides || {};

  const title = o.title || page.title || d.title;
  const description = o.description || page.description || d.description;
  const keywords = o.keywords || page.keywords || d.keywords;
  const robots = o.robots || page.robots || d.robots;
  const type = o.type || page.type || d.type;
  const pathPart = o.path || page.path || "";
  const imageRaw = o.image || page.image || d.image || "";

  return {
    title,
    description,
    keywords,
    robots,
    type,
    locale: SEO.locale,
    siteName: STORE_NAME,
    siteUrl: SITE_URL,
    path: pathPart,
    canonical: pathPart ? absoluteUrl(pathPart) : SITE_URL,
    image: absoluteUrl(imageRaw),
    twitterSite: SEO.twitterSite || "",
    twitterCard: imageRaw ? "summary_large_image" : "summary",
  };
}

/**
 * Entries for /sitemap.xml — only pages with a path and sitemap !== false.
 */
function getSitemapEntries() {
  return Object.values(SEO.pages)
    .filter((p) => p && p.path && p.sitemap !== false)
    .map((p) => ({
      loc: absoluteUrl(p.path),
      changefreq: p.changefreq || "weekly",
      priority: p.priority || "0.5",
    }));
}

// ---------------------------------------------------------------------------
// Default products (seeded into the DB once if the products table is empty)
// ---------------------------------------------------------------------------
const DEFAULT_PRODUCTS = [
  {
    id: "basil",
    name: "basil",
    price: 9.99,
    description:
      "Fresh sweet basil grown in Ohio — fragrant leaves for pesto, salads, and finishing.",
    image:
      "https://images.unsplash.com/photo-1618375569909-3c8616cf7733?w=600&h=600&fit=crop",
  },
  {
    id: "rosemary",
    name: "rosemary",
    price: 9.99,
    description:
      "Woody rosemary sprigs with piney aroma — great for roast meats and bread.",
    image:
      "https://images.unsplash.com/photo-1515586000433-45406d8e6662?w=600&h=600&fit=crop",
  },
  {
    id: "thyme",
    name: "thyme",
    price: 8.99,
    description:
      "Delicate thyme sprigs with earthy, lemony notes — a kitchen staple herb.",
    image:
      "https://images.unsplash.com/photo-1556682851-c0583ebe6f2f?w=600&h=600&fit=crop",
  },
];

/** Fallback image when a new product is added without a photo */
const PLACEHOLDER_IMAGE =
  "https://images.unsplash.com/photo-1582967788606-a171c1080cb0?w=900&h=700&fit=crop";

/** Format a price for display, e.g. 18 → "18.00" */
function formatPrice(price) {
  return Number(price).toFixed(2);
}

/**
 * Build a URL-safe product id from a name.
 * Example: "Wave Ceramic Mug" → "wave-ceramic-mug"
 */
function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

module.exports = {
  STORE_NAME,
  STORE_TAGLINE,
  MAX_ORDERS_PER_IP,
  getMysqlConfig,
  PORT,
  HOST,
  ADMIN_PASSWORD,
  ADMIN_PASSWORD_HASH,
  SITE_URL,
  SEO,
  buildSeo,
  getSitemapEntries,
  absoluteUrl,
  DEFAULT_PRODUCTS,
  PLACEHOLDER_IMAGE,
  formatPrice,
  slugify,
};
