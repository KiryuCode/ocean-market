# Ocean Market

A lightweight, ocean-themed webstore built with **Node.js**, **Express**, and **MySQL**. Browse a product catalog, manage a session-based shopping cart, place orders, and administer products and orders from a simple password-protected admin panel.

---

## Features

- **Product catalog** — seed defaults on first run; manage items from admin
- **Shopping cart** — add, update quantity, remove items (session-based)
- **Buy now & checkout** — single-item or full-cart checkout with contact details
- **Order storage** — MySQL orders with padded IDs (e.g. `0001`)
- **Per-IP rate limiting** — configurable max confirmed orders per client IP
- **Admin panel** — products, photo uploads, order list, receipt view, IP counters
- **Responsive UI** — EJS templates with a clean storefront layout
- **SEO** — meta tags, Open Graph / Twitter cards, JSON-LD, `/robots.txt`, `/sitemap.xml` (edit in `config.js`)

---

## Tech Stack

| Layer        | Technology                   |
|--------------|------------------------------|
| Runtime      | Node.js 18+                  |
| Server       | Express                      |
| Views        | EJS                          |
| Database     | MySQL 8.x via `mysql2`       |
| Sessions     | `express-session`            |
| File uploads | `multer` (product photos)    |
| Email        | `nodemailer` + `.env` SMTP   |

---

## Prerequisites

- [Node.js](https://nodejs.org/) **v18 or later**
- npm (ships with Node.js)
- **MySQL 8.4** (or 8.0+) running locally or reachable over the network

---

## Getting Started

### 1. Clone the repository

```bash
git clone <repository-url>
cd gw_webstore_011
```

### 2. Install dependencies

```bash
npm install
```

### 3. Install and start MySQL 8.4

See **[Install MySQL 8.4](#install-mysql-84-ubuntu)** below, then ensure the service is running:

```bash
sudo systemctl enable --now mysqld
# On some distros the unit is named mysql:
# sudo systemctl enable --now mysql
sudo systemctl status mysqld
```

### 4. Environment

```bash
cp .env.example .env
# edit MYSQL_*, SESSION_SECRET, SITE_URL, SMTP / EMAIL_TO as needed
```

### 5. Create the database and tables

Preferred: use `npm run db:init`, which reads `MYSQL_*` from `.env` (works with local MySQL and managed hosts like Aiven):

```bash
npm run db:init
```

This creates the database (when privileges allow) and the `products`, `orders`, and `ip_order_counts` tables.

For a classic local root bootstrap with hardcoded defaults, you can still run:

```bash
# Preferred on Ubuntu when root uses auth_socket:
sudo mysql < scripts/init-ocean.sql

# Or with a password-authenticated root:
mysql -u root -p < scripts/init-ocean.sql
```

Optional local verify:

```bash
mysql -u ocean -pocean_pass -h 127.0.0.1 ocean -e "SHOW TABLES;"
```

### 6. Start the server

**Production-style:**

```bash
npm start
```

**Development** (auto-restart on file changes):

```bash
npm run dev
```

**Docker** (production path — same image the VPS runs):

```bash
cp .env.example .env
# set MYSQL_* and SESSION_SECRET
docker compose up --build
```

On first successful connect, the app ensures tables exist and seeds the default product catalog if `products` is empty.

### Deploy / production hosting

See **[HOSTING.md](./HOSTING.md)** for remote server setup (Docker Compose, nginx, TLS). Push to `main` to deploy via `.github/workflows/deploy.yml`.

Package a deploy zip (excludes `node_modules` and `.env`):

```bash
npm run pack
# → ocean-market-deploy.zip
```

### 7. Open the store

| Page   | URL |
|--------|-----|
| Store  | http://127.0.0.1:3000 |
| Admin  | http://127.0.0.1:3000/admin?key=ocean-admin-2024 |

---

## Install MySQL 8.4 (Ubuntu)

Official packages from MySQL APT (recommended for **8.4 LTS**):

```bash
# 1) Download and install the MySQL APT config package
cd /tmp
wget https://dev.mysql.com/get/mysql-apt-config_0.8.34-1_all.deb
sudo DEBIAN_FRONTEND=noninteractive dpkg -i mysql-apt-config_0.8.34-1_all.deb
# In the interactive screen pick: MySQL Server & Cluster → mysql-8.4-lts → OK → OK

# 2) Install server + client
sudo apt update
sudo apt install -y mysql-server

# 3) Secure / start
sudo systemctl enable --now mysql
# or: sudo systemctl enable --now mysqld

# 4) (Optional) set root password / security prompts
sudo mysql_secure_installation
```

If `mysql-apt-config` version `0.8.34` is gone, grab the current package from  
https://dev.mysql.com/downloads/repo/apt/ and re-run the `dpkg -i` step.

**Quick check:**

```bash
mysql --version
# should report Ver 8.4.x
```

Then configure `.env` and run `npm run db:init` (see steps 4–5 above).

---

## Configuration

Most store settings live in [`config.js`](./config.js):

| Setting              | Default                 | Description |
|----------------------|-------------------------|-------------|
| `STORE_NAME`         | `Ocean Market`          | Storefront title |
| `STORE_TAGLINE`      | `Curated goods from…`   | Subtitle on the site |
| `MAX_ORDERS_PER_IP`  | `20`                    | Max confirmed orders per client IP |
| `PORT`               | `3000`                  | HTTP port (overridable via env) |
| `ADMIN_KEY`          | `ocean-admin-2024`      | Shared admin password |
| `SITE_URL`           | `http://127.0.0.1:PORT` | Public site origin (also via env) for SEO |
| `SEO`                | defaults + pages        | Titles, descriptions, robots, sitemap entries — see [SEO](#seo) |
| `DEFAULT_PRODUCTS`   | (6 sample items)        | Seeded when the products table is empty |

### Environment variables

Copy [`.env.example`](./.env.example) to `.env` and fill in values. The server loads `.env` automatically via `dotenv`.

| Variable           | Default                              | Description |
|--------------------|--------------------------------------|-------------|
| `PORT`             | `3000`                               | Server port |
| `SITE_URL`         | `http://127.0.0.1:PORT`              | Public origin for SEO (canonical, OG, sitemap) — set to your HTTPS domain in production |
| `SESSION_SECRET`   | `change-me-ocean-market-session`     | Session cookie signing secret (generate with base64 — see below) |
| `MYSQL_HOST`       | `127.0.0.1`                          | MySQL host |
| `MYSQL_PORT`       | `3306`                               | MySQL port |
| `MYSQL_USER`       | `ocean`                              | MySQL user (see init script) |
| `MYSQL_PASSWORD`   | `ocean_pass`                         | MySQL password |
| `MYSQL_DATABASE`   | `ocean`                               | Database name |
| `MYSQL_SSL`        | `false`                              | Set `true` for TLS (required by many managed MySQL hosts) |
| `MYSQL_SSL_CA`     | —                                    | Optional path to a CA PEM; when set, cert verification is enabled |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | `false` (default when SSL on) | Set `true` to require a trusted cert chain |
| `EMAIL_TO`         | —                                    | Recipient for order confirmation emails |
| `SMTP_HOST`        | —                                    | SMTP server hostname (e.g. `smtp.gmail.com`) |
| `SMTP_PORT`        | `587`                                | SMTP port (`587` STARTTLS, or `465` SSL) |
| `SMTP_SECURE`      | `false`                              | Set `true` for port 465 |
| `SMTP_USER`        | —                                    | SMTP login username |
| `SMTP_PASS`        | —                                    | SMTP password / app password |
| `SMTP_FROM`        | `SMTP_USER`                          | From address (optional display name) |

When an order is placed, an HTML receipt is emailed to `EMAIL_TO`. If SMTP is not configured, the order still succeeds and a warning is logged.

Generate a strong `SESSION_SECRET` (base64, 32 random bytes):

```bash
openssl rand -base64 32
```

Paste the output into `.env`:

```bash
SESSION_SECRET=paste-the-openssl-output-here
```

**MySQL TLS (managed / remote DB):** set `MYSQL_SSL=true`. Self-signed certificate chains are **accepted by default** so `npm run db:init` and the app work with providers like Aiven without extra flags. To verify strictly later:

```bash
MYSQL_SSL=true
MYSQL_SSL_CA=/path/to/provider-ca.pem
# or:
MYSQL_SSL_REJECT_UNAUTHORIZED=true
```

Example:

```bash
PORT=8080 SESSION_SECRET=your-secret-here npm start
```

> **Security note:** Change `ADMIN_KEY`, `SESSION_SECRET`, and the MySQL password before any real deployment. Prefer a provider CA (`MYSQL_SSL_CA`) when you are ready to tighten TLS.

---

## SEO

The storefront includes SEO metadata (title, description, keywords, robots, canonical URL, Open Graph, Twitter/X cards, and JSON-LD `OnlineStore` schema), plus `/robots.txt` and `/sitemap.xml`.

All editable SEO copy lives in **[`config.js`](./config.js)** under the `SEO` object. Routes call `buildSeo("pageKey")` so the shared layout (`views/partials/header.ejs`) can render the tags.

### 1. Set your public site URL (required for production)

Canonical links, Open Graph URLs, and the sitemap need your real origin. In `.env`:

```bash
SITE_URL=https://your-domain.example.com
```

No trailing slash. Locally it defaults to `http://127.0.0.1:3000` if unset. Restart the server after changing `.env`.

### 2. Edit site-wide defaults

In `config.js`, update `SEO.defaults`:

| Field | Purpose |
|-------|---------|
| `title` | Fallback `<title>` when a page has no entry |
| `description` | Default meta description / social share blurb (~150–160 chars ideal) |
| `keywords` | Comma-separated keywords (optional; low ranking impact, still useful for some tools) |
| `image` | Default share image: absolute URL **or** path like `/uploads/products/hero.webp` |
| `robots` | Default robots directive, e.g. `index, follow` |
| `type` | Open Graph type (`website` is fine for the store) |

Optional:

| Field | Purpose |
|-------|---------|
| `SEO.twitterSite` | X/Twitter handle **without** `@` (adds `twitter:site`) |
| `SEO.locale` | Open Graph locale (default `en_US`) |

Example:

```js
// config.js
const SEO = {
  defaults: {
    title: `${STORE_NAME} — ${STORE_TAGLINE}`,
    description: "Your custom store description for search results…",
    keywords: "your, keywords, here",
    image: "/uploads/products/og-share.webp", // or full https://…
    robots: "index, follow",
    type: "website",
  },
  twitterSite: "yourhandle", // optional
  locale: "en_US",
  pages: { /* … */ },
};
```

### 3. Edit per-page SEO

Still in `config.js`, each key under `SEO.pages` maps to a route:

| Key | Typical route | Notes |
|-----|---------------|--------|
| `home` | `/` | Main catalog — keep this indexable |
| `cart` | `/cart` | `noindex` by default (session-specific) |
| `confirm` | checkout / buy confirm | `noindex, nofollow` |
| `success` | order confirmation | `noindex, nofollow` |
| `limit` | order limit page | `noindex, nofollow` |
| `notFound` | 404 | `noindex, nofollow` |
| `admin` | `/admin` | `noindex, nofollow` |

Per-page fields:

| Field | Purpose |
|-------|---------|
| `title` | Page `<title>` and `og:title` |
| `description` | Meta / social description |
| `keywords` | Optional override of defaults |
| `image` | Optional page-specific share image |
| `robots` | e.g. `index, follow` or `noindex, follow` |
| `path` | Path used for **canonical** URL and sitemap (`/` , `/cart`, …) |
| `sitemap` | Set `false` to exclude from `/sitemap.xml` |
| `changefreq` | Sitemap hint: `daily`, `weekly`, … |
| `priority` | Sitemap priority `"0.0"`–`"1.0"` |

Example — reword the homepage:

```js
home: {
  title: `${STORE_NAME} — Inventory`,
  description:
    "Browse ocean-inspired mugs, totes, candles, and apparel. Check stock and order online.",
  keywords: "ocean market, shop, inventory",
  path: "/",
  changefreq: "daily",
  priority: "1.0",
},
```

After editing `config.js`, restart the Node process (`npm start` / systemd).

### 4. Dynamic overrides (optional)

Routes may pass extra fields for one-off titles (e.g. product name on confirm):

```js
seo: buildSeo("confirm", {
  title: `Confirm order — ${product.name}`,
  description: product.description,
  image: product.image,
})
```

Override keys match the page fields (`title`, `description`, `keywords`, `image`, `robots`, `path`, `type`).

### 5. robots.txt and sitemap

| URL | What it does |
|-----|----------------|
| `/robots.txt` | Allows public crawl; disallows `/admin`, cart, buy, and order paths; points to the sitemap |
| `/sitemap.xml` | Lists every `SEO.pages` entry that has a `path` and `sitemap !== false` |

To add a new public page to the sitemap later:

1. Add an entry under `SEO.pages` with `path: "/your-path"`.
2. Call `buildSeo("yourKey")` when rendering that page in `app.js`.
3. Do **not** set `sitemap: false`.

### 6. Quick checklist before go-live

1. Set `SITE_URL` in `.env` to your HTTPS domain.
2. Customize `SEO.defaults.description` and `home` title/description for your brand.
3. Set `SEO.defaults.image` (or a page `image`) to a real share image (1200×630 works well for social).
4. Confirm `http://your-domain/robots.txt` and `…/sitemap.xml` look correct.
5. Optionally paste a product URL into [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) or similar to verify Open Graph tags.

---

## Admin Panel

1. Visit `/admin` (or `/admin?key=YOUR_ADMIN_KEY`).
2. If you open `/admin` without a key, use the login form and enter the admin key.
3. From the dashboard you can:
   - View and open order receipts
   - Add / edit products and stock
   - Upload product photos (JPEG, PNG, GIF, WebP; max 5 MB)
   - Inspect and reset per-IP order counters

Default key (from `config.js`):

```text
ocean-admin-2024
```

---

## Project Structure

```text
.
├── app.js                 # Express app, routes, middleware
├── mail.js                # Order confirmation email (HTML receipt via SMTP)
├── cart.js                # Session cart helpers
├── config.js              # Branding, limits, admin key, seed products, SEO
├── db.js                  # MySQL pool, schema ensure, products, orders, IP limits
├── .env.example           # MySQL + SMTP + SITE_URL template (copy to .env)
├── package.json
├── Dockerfile             # Production Node image
├── docker-compose.yml     # App container; publishes HOST_BIND:PORT
├── scripts/
│   ├── init-db.js          # npm run db:init — bootstrap from MYSQL_* in .env
│   ├── init-ocean.sql      # Static local SQL fallback (CREATE DATABASE/user/tables)
│   ├── deploy.sh           # SSH / rsync + docker compose
│   └── pack-deploy.sh     # Deploy zip builder
├── public/
│   ├── css/style.css      # Storefront styles
│   ├── js/                # Client-side cart / admin scripts
│   └── uploads/products/  # Uploaded product images
└── views/
    ├── index.ejs          # Catalog
    ├── cart.ejs           # Cart
    ├── confirm.ejs        # Checkout confirmation
    ├── success.ejs        # Order success
    ├── admin*.ejs         # Admin UI
    ├── limit.ejs          # Order limit reached
    ├── 404.ejs
    └── partials/          # header (SEO meta) + footer
```

Public SEO endpoints (no login): `/robots.txt`, `/sitemap.xml`.

---

## Scripts

| Command         | Description |
|-----------------|-------------|
| `npm start`     | Start the server |
| `npm run dev`   | Start with Node’s `--watch` for live reload |
| `npm run db:init` | Bootstrap DB + tables using `MYSQL_*` from `.env` (`scripts/init-db.js`) |
| `npm run pack`  | Build `ocean-market-deploy.zip` |
| `docker compose up --build` | Build and run the production container |

---

## How It Works

1. **DB bootstrap** — Run `npm run db:init` once (uses `.env`) to create the database and tables.
2. **First boot** — `db.initDb()` ensures tables exist and seeds `DEFAULT_PRODUCTS` if the catalog is empty.
3. **Browsing** — `/` lists products from MySQL.
4. **Cart** — Items live in the Express session; quantities and line totals are computed server-side.
5. **Checkout** — Buy-now or cart checkout records an order, stores contact info, and increments the client IP counter (blocked when `MAX_ORDERS_PER_IP` is reached).
6. **Admin** — Protected by `ADMIN_KEY`; manages catalog images, inventory, orders, and IP limits.

There is no real payment processor — orders are recorded for demo / inventory-style use.

---

## License

Private / unpublished unless otherwise specified.
# gwllc-ocean-market
# ocean-market

#
