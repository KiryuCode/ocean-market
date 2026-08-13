# Ocean Market

A small, server-rendered webstore. Shoppers browse the catalog, add items to a cart, and place orders. Store owners manage products, photos, and orders from a password-protected admin panel.

There is no separate frontend build. Express serves **EJS** pages and static files from `public/`. **MySQL** holds products, orders, and per-IP counters. **express-session** cookies back the cart and admin login. Admin passwords are checked with **bcrypt** (`ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH` in `.env`). Photo uploads go through **multer**; order emails are optional via **Nodemailer**/SMTP.

Local development is Node 18+ and `npm run dev`. Production is a **Docker Compose** container behind nginx, deployed by GitHub Actions. Details live in [HOSTING.md](./HOSTING.md).

## Features

- Product catalog (seeded on first run; manage items from admin)
- Session-based shopping cart
- Buy now and full-cart checkout
- MySQL order storage with padded IDs (e.g. `0001`)
- Per-IP order rate limiting
- Admin panel for products, photo uploads, orders, and IP counters
- Order confirmation email when SMTP is configured
- SEO metadata, `/robots.txt`, and `/sitemap.xml` (edit in `config.js`)

## Requirements

- [Node.js](https://nodejs.org/) 18 or later
- npm (ships with Node.js)
- MySQL 8.0+ running locally or reachable over the network

## Run locally

### 1. Clone and install

```bash
git clone https://github.com/KiryuCode/ocean-market.git
cd ocean-market
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at least:

| Variable         | Notes                                      |
|------------------|--------------------------------------------|
| `MYSQL_HOST`     | Default `127.0.0.1`                        |
| `MYSQL_USER`     | Default `ocean`                            |
| `MYSQL_PASSWORD` | Default `ocean_pass`                       |
| `MYSQL_DATABASE` | Default `ocean`                            |
| `SESSION_SECRET` | Use a random string (see below)            |
| `ADMIN_PASSWORD` **or** `ADMIN_PASSWORD_HASH` | One is enough (see [Admin login](#admin-login)) |
| `SITE_URL`       | Public origin, no trailing slash           |

Generate a session secret:

```bash
openssl rand -base64 32
```

SMTP (`SMTP_*` and `EMAIL_TO`) is optional. Orders still succeed if email is not configured.

### 3. Create the database

Make sure MySQL is running, then:

```bash
npm run db:init
```

This reads `MYSQL_*` from `.env` and creates the database and tables (`products`, `orders`, `ip_order_counts`).

Local SQL fallback if you prefer:

```bash
sudo mysql < scripts/init-ocean.sql
# or: mysql -u root -p < scripts/init-ocean.sql
```

### 4. Start the server

```bash
# development (restarts on file changes)
npm run dev

# production-style
npm start
```

Then open:

| Page  | URL                                                      |
|-------|----------------------------------------------------------|
| Store | http://127.0.0.1:3000                                    |
| Admin | http://127.0.0.1:3000/admin                              |

On first successful connect, the app ensures tables exist and seeds the default catalog if `products` is empty.

## Docker

```bash
cp .env.example .env
# set MYSQL_*, SESSION_SECRET, and ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH)
docker compose up --build
```

The app is published on port `3000` by default (`PORT` / `HOST_BIND` in `.env`). MySQL is not part of this Compose file — point `MYSQL_*` at a database the container can reach.

## Scripts

| Command                       | Description                                      |
|-------------------------------|--------------------------------------------------|
| `npm start`                   | Start the server                                 |
| `npm run dev`                 | Start with Node `--watch`                        |
| `npm run db:init`             | Create database and tables from `.env`           |
| `npm run admin:hash -- 'password'` | Print a bcrypt hash for `ADMIN_PASSWORD_HASH` |
| `npm run pack`                | Build a zip for a manual server upload           |
| `docker compose up --build`   | Build and run the app container                  |

## Configuration

Store branding, order limits, seed products, and SEO live in [`config.js`](./config.js). Connection secrets, the admin password, and SMTP live in `.env` (see [`.env.example`](./.env.example)).

### Admin login

Admin login is session-based. Visit `/admin` and sign in. The password is never placed in the URL.

Set **one** of these in `.env`:

| Variable               | When to use |
|------------------------|-------------|
| `ADMIN_PASSWORD`       | Plaintext password. Hashed with bcrypt at boot. Fine for local dev. |
| `ADMIN_PASSWORD_HASH`  | bcrypt hash of the password. Preferred, especially in production. |

`ADMIN_PASSWORD` is **not** required if `ADMIN_PASSWORD_HASH` is set. The hash is used on its own. If both are set, `ADMIN_PASSWORD_HASH` wins and the plaintext value is ignored.

Generate a hash (example password `password123`):

```bash
npm run admin:hash -- 'password123'
```

The script prints a line like:

```
ADMIN_PASSWORD_HASH=$2b$12$…
```

Paste that into `.env` and **remove** `ADMIN_PASSWORD` so the plaintext password is not sitting next to the hash.

Change `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, and the MySQL password before production. For managed MySQL, set `MYSQL_SSL=true` (the remote server certificate is verified by default; set `MYSQL_SSL_CA` to the provider CA file if needed).

Production hosting (Docker Compose, nginx, TLS) is documented in [HOSTING.md](./HOSTING.md).

## License

All rights reserved.
