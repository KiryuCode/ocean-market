/**
 * Easy-to-edit configuration for the webstore.
 * Products live in MySQL (database `ocean` by default) after first run
 * (seeded from DEFAULT_PRODUCTS). Manage products and photos from /admin.
 *
 * Initialize the database with: mysql -u root -p < scripts/init-ocean.sql
 * Connection credentials: MYSQL_* in .env
 */

// ---------------------------------------------------------------------------
// Store branding
// ---------------------------------------------------------------------------
const STORE_NAME = "Ocean Market";
const STORE_TAGLINE = "Curated goods from the deep blue";

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
 * MYSQL_SSL=true enables TLS (secure mode) for the connection — use when
 * connecting to a remote MySQL that requires or supports encrypted links.
 * Local 127.0.0.1 setups usually leave this false/off.
 */
function getMysqlConfig() {
  const sslEnabled =
    process.env.MYSQL_SSL === "1" ||
    process.env.MYSQL_SSL === "true" ||
    process.env.MYSQL_SSL === "TRUE";

  return {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "ocean",
    password: process.env.MYSQL_PASSWORD || "ocean_pass",
    database: process.env.MYSQL_DATABASE || "ocean",
    // When true, mysql2 uses TLS (ssl-mode equivalent of REQUIRED + CA verify)
    ssl: sslEnabled
      ? {
          // Verify the server certificate against system CAs
          rejectUnauthorized: true,
        }
      : undefined,
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
 * Simple shared password for the admin order list (query param or form).
 * Visit: /admin?key=YOUR_ADMIN_KEY
 */
const ADMIN_KEY = "ocean-admin-2024";

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
      "Shop curated ocean-inspired goods at Ocean Market — mugs, totes, candles, prints, and more. Browse inventory and place orders online.",
    keywords:
      "ocean market, online store, ocean gifts, ceramic mug, canvas tote, soy candle, art print, hoodie, curated goods",
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
        "Browse the Ocean Market inventory: ocean-inspired mugs, totes, candles, notebooks, art prints, and apparel. Check stock and order online.",
      keywords:
        "ocean market inventory, shop ocean goods, wave mug, tide tote, coral candle, harbor notebook, nautilus print",
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
    id: "wave-mug",
    name: "Wave Ceramic Mug",
    price: 18.0,
    description:
      "A hand-glazed mug with soft ocean-wave ridges. Holds 12 oz.",
    image:
      "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=600&h=600&fit=crop",
  },
  {
    id: "tide-tote",
    name: "Tide Canvas Tote",
    price: 24.0,
    description:
      "Sturdy canvas tote in deep navy. Perfect for market runs or the beach.",
    image:
      "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=600&h=600&fit=crop",
  },
  {
    id: "coral-candle",
    name: "Coral Reef Candle",
    price: 22.0,
    description:
      "Soy wax candle with notes of sea salt, driftwood, and soft citrus.",
    image:
      "https://images.unsplash.com/photo-1602606973294-e0c1f3c3c8f0?w=600&h=600&fit=crop",
  },
  {
    id: "harbor-notebook",
    name: "Harbor Notebook",
    price: 14.0,
    description:
      "A5 lined notebook with a water-resistant cover and ribbon bookmark.",
    image:
      "https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=600&h=600&fit=crop",
  },
  {
    id: "nautilus-print",
    name: "Nautilus Art Print",
    price: 32.0,
    description:
      "Museum-quality 11×14 print of a classic nautilus shell study.",
    image:
      "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=600&h=600&fit=crop",
  },
  {
    id: "deep-blue-hoodie",
    name: "Deep Blue Hoodie",
    price: 58.0,
    description:
      "Soft midweight hoodie in ocean navy. Unisex fit, fleece-lined.",
    image:
      "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=600&h=600&fit=crop",
  },
];

/** Fallback image when a new product is added without a photo */
const PLACEHOLDER_IMAGE =
  "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=600&h=600&fit=crop";

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
  ADMIN_KEY,
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
