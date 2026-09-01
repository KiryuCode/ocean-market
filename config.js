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
    id: "anubias-nana",
    name: "Anubias Nana",
    price: 12.99,
    description: "Thick, slow leaves that shrug off neglect. Tie the rhizome to rock or wood — bury it and it sulks.",
    image: "https://images.unsplash.com/photo-1524704654690-b56c05c78a00?w=900&h=700&fit=crop",
    category: "Aquatic Plants",
    qtyAvailable: 18,
  },
  {
    id: "java-fern",
    name: "Java Fern",
    price: 9.99,
    description: "The plant you give a new tank. Attach it, leave it, watch the runners write across the hardscape.",
    image: "https://images.unsplash.com/photo-1571752726703-5e7d1f6a986d?w=900&h=700&fit=crop",
    category: "Aquatic Plants",
    qtyAvailable: 22,
  },
  {
    id: "amazon-sword",
    name: "Amazon Sword",
    price: 8.5,
    description: "A background rosette with an appetite. Heavy root tabs, and it will fill a wall of green.",
    image: "https://images.unsplash.com/photo-1610448721566-47369c768e70?w=900&h=700&fit=crop",
    category: "Aquatic Plants",
    qtyAvailable: 16,
  },
  {
    id: "dwarf-hairgrass",
    name: "Dwarf Hairgrass",
    price: 11.0,
    description: "Fine grass for a bright foreground. CO2 turns scattered plugs into a single lawn.",
    image: "https://images.unsplash.com/photo-1551244072-5d12893278ab?w=900&h=700&fit=crop",
    category: "Aquatic Plants",
    qtyAvailable: 14,
  },
  {
    id: "crypt-wendtii",
    name: "Cryptocoryne Wendtii",
    price: 10.5,
    description: "Bronze crypt that melts after a move, then comes back denser than you planted it.",
    image: "https://images.unsplash.com/photo-1524704796725-9fc3084b4ce3?w=900&h=700&fit=crop",
    category: "Aquatic Plants",
    qtyAvailable: 15,
  },
  {
    id: "water-wisteria",
    name: "Water Wisteria",
    price: 6.99,
    description: "A nitrate sponge on a stem. Pinch the tops and it bushes; ignore it and it still works.",
    image: "https://images.unsplash.com/photo-1473496169904-658ba7c44d8a?w=900&h=700&fit=crop",
    category: "Aquatic Plants",
    qtyAvailable: 24,
  },
  {
    id: "red-tiger-lotus",
    name: "Red Tiger Lotus",
    price: 14.0,
    description: "A bulb that throws mottled red pads. Trim the runners if you want a single centerpiece.",
    image: "https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=900&h=700&fit=crop",
    category: "Aquatic Plants",
    qtyAvailable: 10,
  },
  {
    id: "bucephalandra-kedagang",
    name: "Bucephalandra 'Kedagang'",
    price: 16.0,
    description: "Iridescent epiphyte for low-tech hardscape. Slow, stubborn, and worth the wait.",
    image: "https://images.unsplash.com/photo-1466692476866-aef1dfb1e735?w=900&h=700&fit=crop",
    category: "Aquatic Plants",
    qtyAvailable: 12,
  },
  {
    id: "monte-carlo",
    name: "Monte Carlo",
    price: 12.0,
    description: "Tiny leaves, bright green carpet. High light and CO2 — otherwise it climbs instead of creeps.",
    image: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=900&h=700&fit=crop",
    category: "Aquatic Plants",
    qtyAvailable: 14,
  },
  {
    id: "jungle-val",
    name: "Jungle Vallisneria",
    price: 7.5,
    description: "Tall tape-grass that colonizes by runners. Softens the back glass of a display.",
    image: "https://images.unsplash.com/photo-1509423350716-97f9360b4e09?w=900&h=700&fit=crop",
    category: "Aquatic Plants",
    qtyAvailable: 20,
  },
  {
    id: "green-star-polyps",
    name: "Green Star Polyps",
    price: 29.0,
    description: "Neon polyps that encrust a plug and then the rock. Easy flow, moderate light, give it a border.",
    image: "https://images.unsplash.com/photo-1546026423-cc4642628d2b?w=900&h=700&fit=crop",
    category: "Soft Corals",
    qtyAvailable: 8,
  },
  {
    id: "pulsing-xenia",
    name: "Pulsing Xenia",
    price: 24.0,
    description: "The coral that waves back. Fast — park it on a frag island before it takes the wall.",
    image: "https://images.unsplash.com/photo-1582967788606-a171c1080cb0?w=900&h=700&fit=crop",
    category: "Soft Corals",
    qtyAvailable: 7,
  },
  {
    id: "toadstool-leather",
    name: "Toadstool Leather",
    price: 39.0,
    description: "A ruffled leather cap that sheds a waxy film as it grows. Classic first softie.",
    image: "https://images.unsplash.com/photo-1541625602330-2277a4c46182?w=900&h=700&fit=crop",
    category: "Soft Corals",
    qtyAvailable: 6,
  },
  {
    id: "kenya-tree",
    name: "Kenya Tree Coral",
    price: 32.0,
    description: "Branching filler that drops baby colonies. Low-maintenance and a little invasive, in a good way.",
    image: "https://images.unsplash.com/photo-1559825481-12a05cc00344?w=900&h=700&fit=crop",
    category: "Soft Corals",
    qtyAvailable: 8,
  },
  {
    id: "rhodactis-mushroom",
    name: "Rhodactis Mushroom",
    price: 18.0,
    description: "A juicy disc for the lower ledges. Sit it on rubble, never loose on sand.",
    image: "https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?w=900&h=700&fit=crop",
    category: "Soft Corals",
    qtyAvailable: 12,
  },
  {
    id: "hammer-coral",
    name: "Green Hammer Coral",
    price: 65.0,
    description: "Branching hammers that want a sway, not a thrash. Keep calcium honest and neighbors at a distance.",
    image: "https://images.unsplash.com/photo-1583212292454-1fe6229603b7?w=900&h=700&fit=crop",
    category: "LPS Corals",
    qtyAvailable: 5,
  },
  {
    id: "holy-grail-torch",
    name: "Holy Grail Torch",
    price: 89.0,
    description: "Gold-tipped torch heads with long sweepers. Give it a throne and empty water around it.",
    image: "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=900&h=700&fit=crop",
    category: "LPS Corals",
    qtyAvailable: 4,
  },
  {
    id: "frogspawn",
    name: "Frogspawn Coral",
    price: 58.0,
    description: "Grape-like LPS branches under moderate light. Stable alk, gentle flow, no sudden chemistry.",
    image: "https://images.unsplash.com/photo-1682687982501-1e58ab814714?w=900&h=700&fit=crop",
    category: "LPS Corals",
    qtyAvailable: 5,
  },
  {
    id: "acan-lord",
    name: "Acan Lord",
    price: 72.0,
    description: "Meaty, painted LPS for a low ledge. Mild, indirect flow — it sulks in a blast.",
    image: "https://images.unsplash.com/photo-1544551763-77ef2d0cfc6c?w=900&h=700&fit=crop",
    category: "LPS Corals",
    qtyAvailable: 4,
  },
  {
    id: "scoly-master",
    name: "Scolymia 'Master'",
    price: 120.0,
    description: "A showpiece disk. Low light, low flow, and the kind of alkalinity you write down.",
    image: "https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=900&h=700&fit=crop",
    category: "LPS Corals",
    qtyAvailable: 3,
  },
  {
    id: "acropora-millepora",
    name: "Acropora Millepora",
    price: 75.0,
    description: "SPS table coral for tanks that already have a routine. High light, chaotic flow, patience.",
    image: "https://images.unsplash.com/photo-1513553404607-988bf2703777?w=900&h=700&fit=crop",
    category: "SPS Corals",
    qtyAvailable: 4,
  },
  {
    id: "montipora-cap",
    name: "Montipora Capricornis",
    price: 42.0,
    description: "Plating monti that fans into a shelf. The forgiving first SPS if the lights are real.",
    image: "https://images.unsplash.com/photo-1468581263533-11e2d3bb7133?w=900&h=700&fit=crop",
    category: "SPS Corals",
    qtyAvailable: 6,
  },
  {
    id: "pink-stylophora",
    name: "Pink Stylophora",
    price: 48.0,
    description: "A tight pink bush for the high-PAR corner. Strong random flow keeps the slime off.",
    image: "https://images.unsplash.com/photo-1471922694854-ff1b63b51df3?w=900&h=700&fit=crop",
    category: "SPS Corals",
    qtyAvailable: 5,
  },
  {
    id: "birds-nest",
    name: "Bird's Nest Coral",
    price: 38.0,
    description: "Fine-branching Seriatopora that grows like it has somewhere to be. Mixed-reef friendly SPS.",
    image: "https://images.unsplash.com/photo-1505765050516-f72dcac9c60e?w=900&h=700&fit=crop",
    category: "SPS Corals",
    qtyAvailable: 6,
  },
  {
    id: "zoa-fruit-loop",
    name: "Zoanthid 'Fruit Loop'",
    price: 28.0,
    description: "Candy-ring zoas on a gold-mouth frag. Handle like palytoxin is real — because it is.",
    image: "https://images.unsplash.com/photo-1615751072497-5f5169febe17?w=900&h=700&fit=crop",
    category: "Zoanthids & Anemones",
    qtyAvailable: 9,
  },
  {
    id: "zoa-orange-bam-bam",
    name: "Zoanthid 'Orange Bam Bam'",
    price: 35.0,
    description: "A blazing orange colony that photographs itself. Dip the frag; give it moderate light.",
    image: "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?w=900&h=700&fit=crop",
    category: "Zoanthids & Anemones",
    qtyAvailable: 7,
  },
  {
    id: "rose-bubble-tip",
    name: "Rose Bubble Tip Anemone",
    price: 55.0,
    description: "The clown host everyone means. Mature tank, a powerhead nearby, and a quarantine first.",
    image: "https://images.unsplash.com/photo-1560275619-4662e36fa65c?w=900&h=700&fit=crop",
    category: "Zoanthids & Anemones",
    qtyAvailable: 4,
  },
  {
    id: "rock-flower-anemone",
    name: "Rock Flower Anemone",
    price: 22.0,
    description: "A stay-put mini for the sandbed. Color without the midnight walkabout of a BTA.",
    image: "https://images.unsplash.com/photo-1437622368342-7a3d73a501c8?w=900&h=700&fit=crop",
    category: "Zoanthids & Anemones",
    qtyAvailable: 8,
  },
  {
    id: "ocellaris-pair",
    name: "Ocellaris Clownfish Pair",
    price: 45.0,
    description: "Captive-bred pair, reef-safe, already arguing over a rock. Ready to host when you are.",
    image: "https://images.unsplash.com/photo-1535591273668-578e31182c4f?w=900&h=700&fit=crop",
    category: "Livestock",
    qtyAvailable: 6,
  },
  {
    id: "fire-shrimp",
    name: "Blood Red Fire Shrimp",
    price: 28.0,
    description: "Lysmata debelius — shy the first week, tank mascot the second. Keep a cave it can claim.",
    image: "https://images.unsplash.com/photo-1618044733300-9472054094ee?w=900&h=700&fit=crop",
    category: "Livestock",
    qtyAvailable: 8,
  },
  {
    id: "nassarius-five",
    name: "Nassarius Snail 5-pack",
    price: 15.0,
    description: "Five sand-sifters that bury between meals. They need a sandbed, not bare glass.",
    image: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=900&h=700&fit=crop",
    category: "Livestock",
    qtyAvailable: 14,
  },
  {
    id: "blue-tang-juvenile",
    name: "Pacific Blue Tang (juvenile)",
    price: 89.0,
    description: "A young Paracanthurus. Large, established system, daily nori, and room to cruise.",
    image: "https://images.unsplash.com/photo-1516684669134-de6f7c473a2a?w=900&h=700&fit=crop",
    category: "Livestock",
    qtyAvailable: 2,
  },
  {
    id: "fiji-live-rock",
    name: "Fiji Live Rock (per lb)",
    price: 8.99,
    description: "Porous base rock sold by the pound. Rinse, cure, then let it become the skeleton of the reef.",
    image: "https://images.unsplash.com/photo-1476673160081-cf065307f653?w=900&h=700&fit=crop",
    category: "Supplies",
    qtyAvailable: 40,
  },
  {
    id: "reef-salt-160",
    name: "Reef Salt Mix 160 gal",
    price: 52.0,
    description: "Balanced mix for a 160-gallon batch of mixed reef. Mix to 1.025, aerate, then use.",
    image: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=900&h=700&fit=crop",
    category: "Supplies",
    qtyAvailable: 18,
  },
  {
    id: "master-test-kit",
    name: "Master Reef Test Kit",
    price: 64.0,
    description: "Alk, calcium, mag, nitrate, phosphate. Test weekly. Write the numbers down.",
    image: "https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?w=900&h=700&fit=crop",
    category: "Supplies",
    qtyAvailable: 12,
  },
  {
    id: "frozen-mysis-10",
    name: "Frozen Mysis 10-pack",
    price: 18.0,
    description: "PE mysis cubes. Thaw in tank water; keep the melt water out of the display.",
    image: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=900&h=700&fit=crop",
    category: "Supplies",
    qtyAvailable: 25,
  },
  {
    id: "reef-led-24",
    name: "Reef LED Light 24\"",
    price: 189.0,
    description: "Full-spectrum fixture with a sunset ramp. Hang or brace it over a 24-inch rim.",
    image: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=900&h=700&fit=crop",
    category: "Supplies",
    qtyAvailable: 6,
  },
  {
    id: "protein-skimmer-nano",
    name: "Nano Protein Skimmer",
    price: 79.0,
    description: "Quiet in-sump skimmer for 20–40 gallon reefs. Empty the cup before it tells on you.",
    image: "https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=900&h=700&fit=crop",
    category: "Supplies",
    qtyAvailable: 8,
  }
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
