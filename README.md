# Ocean Market

A lightweight, ocean-themed webstore built with **Node.js**, **Express**, and **MySQL**. Browse a product catalog, manage a session-based shopping cart, place orders, and administer products and orders from a password-protected admin panel.

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
| Admin | http://127.0.0.1:3000/admin?key=ocean-admin-2024         |

On first successful connect, the app ensures tables exist and seeds the default catalog if `products` is empty.

## Docker

```bash
cp .env.example .env
# set MYSQL_* and SESSION_SECRET
docker compose up --build
```

The app is published on port `3000` by default (`PORT` / `HOST_BIND` in `.env`).

## Scripts

| Command                       | Description                                      |
|-------------------------------|--------------------------------------------------|
| `npm start`                   | Start the server                                 |
| `npm run dev`                 | Start with Node `--watch`                        |
| `npm run db:init`             | Create database and tables from `.env`           |
| `npm run pack`                | Build `ocean-market-deploy.zip`                  |
| `docker compose up --build`   | Build and run the production container           |

## Configuration

Store branding, admin key, order limits, seed products, and SEO live in [`config.js`](./config.js). Connection secrets and SMTP live in `.env` (see [`.env.example`](./.env.example)).

Default admin key (change before any real deploy):

```text
ocean-admin-2024
```

Visit `/admin` and enter the key, or use `/admin?key=YOUR_ADMIN_KEY`.

Change `ADMIN_KEY`, `SESSION_SECRET`, and the MySQL password before production. For managed MySQL, set `MYSQL_SSL=true`.

Production hosting (Docker Compose, nginx, TLS) is documented in [HOSTING.md](./HOSTING.md).

## License

All rights reserved.
