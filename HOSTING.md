# Hosting Ocean Market (production)

This is a **Node.js + Express + MySQL** app packaged as a **Docker Compose** stack. There is no separate frontend build step. GitHub Actions rsyncs the tree and runs `docker compose up --build -d` on the VPS.

Production today:

- VPS `root@74.208.35.191` → `/var/www/ocean-market`
- Container published as `127.0.0.1:4840` (`HOST_BIND=127.0.0.1`, `PORT=4840`)
- nginx (`adavis.shop`) reverse-proxies to that loopback port
- MySQL is the Aiven host in the server `.env` (not a container)

---

## What’s in the deploy zip

| Include | Notes |
|---------|--------|
| App source (`app.js`, `mail.js`, `db.js`, …) | Yes |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore` | Yes |
| `views/`, `public/` (CSS, JS, product images) | Yes |
| `package.json` + `package-lock.json` | Yes — `npm ci` runs **inside the image** |
| `scripts/init-ocean.sql` | Database bootstrap for `ocean` |
| `.env.example` | Template — **create `.env` on the server** |
| `node_modules/` | **Not** in the zip |
| `.git/` | Not included |

---

## Server requirements

- **Linux** VPS or similar (Ubuntu 22.04+ is fine)
- **Docker Engine** + **Compose v2** (`docker.io` and `docker-compose-v2` on Ubuntu)
- **MySQL 8.4** (or 8.0+) reachable from the container (local, or a managed host such as Aiven)
- Outbound SMTP (port **587** or **465**) if you want order emails
- Optional but recommended: **nginx** (or Caddy) as reverse proxy + TLS

You do **not** need Node.js, fnm, nvm, or PM2 on the host.

---

## 1. Upload and unpack

```bash
# On your laptop
scp ocean-market-deploy.zip user@YOUR_SERVER:/home/user/

# On the server
cd /home/user
unzip ocean-market-deploy.zip -d ocean-market
cd ocean-market
```

Or upload via SFTP/FileZilla into e.g. `/var/www/ocean-market`.

The GitHub Actions workflow (`.github/workflows/deploy.yml`) rsyncs the same files and runs [`scripts/deploy.sh`](./scripts/deploy.sh).

---

## 2. Install Docker (if needed)

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
docker --version
docker compose version
```

Skip the snap package — snap confinement often breaks bind mounts for `.env` and `public/uploads`.

---

## 3. Create the MySQL database

Managed MySQL (Aiven, etc.): create the `ocean` database in the provider UI, then run from a machine that can reach it:

```bash
# uses MYSQL_* from .env
npm run db:init
```

Or apply the static local script (localhost MySQL only):

```bash
sudo mysql < scripts/init-ocean.sql
```

The app also ensures tables exist on startup. **Change the password** for production (update both MySQL and `.env`).

---

## 4. Create `.env` for production

```bash
cp .env.example .env
nano .env   # or vim
```

Minimum production settings:

```env
NODE_ENV=production
PORT=4840
HOST=0.0.0.0
HOST_BIND=127.0.0.1
SESSION_SECRET=paste-a-long-random-string-here

TRUST_PROXY=true
COOKIE_SECURE=true
SITE_URL=https://adavis.shop

MYSQL_HOST=your-mysql-host.example.com
MYSQL_PORT=3306
MYSQL_USER=ocean
MYSQL_PASSWORD=your-strong-db-password
MYSQL_DATABASE=ocean
MYSQL_SSL=true

EMAIL_TO=andrew.davis64@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=your16charapppassword
SMTP_FROM="Ocean Market <your-gmail@gmail.com>"
```

Notes:

- Generate `SESSION_SECRET` with: `openssl rand -hex 32`
- `HOST_BIND=127.0.0.1` keeps the published port on loopback; nginx is the public entry
- Compose overrides `HOST=0.0.0.0` inside the container so the published port works
- Gmail app passwords: spaces optional; without spaces is simplest in `.env`
- Set a strong `ADMIN_PASSWORD` in `.env`, or store only `ADMIN_PASSWORD_HASH` (`npm run admin:hash -- 'your-password'`)

---

## 5. Start the stack

```bash
mkdir -p public/uploads/products
# container runs as uid 1000 (node)
sudo chown -R 1000:1000 public/uploads
docker compose up --build -d
docker compose ps
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4840/healthz
```

`/healthz` is **503** until MySQL init succeeds, then **200**.

Local (no nginx): leave `HOST_BIND` unset (or `0.0.0.0`), set `PORT=3000`, and open http://127.0.0.1:3000.

---

## 6. Reverse proxy + HTTPS (nginx)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/ocean-market
```

```nginx
server {
    listen 80;
    server_name shop.example.com;
    server_tokens off;

    client_max_body_size 6M;   # product photo uploads

    location / {
        proxy_pass http://127.0.0.1:4840;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_hide_header X-Powered-By;
    }
}
```

`server_tokens off` must also be in `http` (or a `conf.d` snippet) so the version is hidden on every vhost, including default error pages. Deploy writes `/etc/nginx/conf.d/ocean-market-security.conf`. The app sets HSTS, CSP, `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy`.

```bash
sudo ln -s /etc/nginx/sites-available/ocean-market /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# TLS certificate (DNS must point to this server first)
sudo certbot --nginx -d shop.example.com
```

With HTTPS:

- `TRUST_PROXY=true`
- `COOKIE_SECURE=true`
- `HOST_BIND=127.0.0.1`
- Restart: `docker compose up -d`

This host already uses `adavis.shop` → `127.0.0.1:4840`.

---

## 7. Firewall (optional but recommended)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
# Do not expose 4840 or 3306 publicly if nginx is on 80/443 and MySQL is remote
```

---

## 8. Post-deploy checklist

1. Open the storefront URL and place a **test order**
2. Confirm email arrives at `EMAIL_TO`
3. Log into admin at `/admin` with the password from `.env`
4. Confirm product photos load
5. Confirm MySQL connection works (provider console, or `docker compose logs web`)
6. Confirm `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH` is set in `.env` (not the default)

---

## Updating later

Push to `main` (or run the **Deploy** workflow). That rsyncs source and runs:

```bash
docker compose up --build -d --remove-orphans
```

`.env` and `public/uploads` are left in place.

Manual update:

```bash
cd /var/www/ocean-market
# deploy new files, keep .env and public/uploads
docker compose up --build -d
```

Back up regularly:

```bash
# managed MySQL: use the provider dump, or:
# mysqldump -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p "$MYSQL_DATABASE" \
#   > "backups/ocean-$(date +%F).sql"
# and public/uploads/products/
```

Useful commands:

| Command | Purpose |
|---------|---------|
| `docker compose ps` | Container status |
| `docker compose logs -f web` | Tail logs |
| `docker compose up --build -d` | Rebuild and restart after a deploy |
| `docker compose down` | Stop without deleting images |
| `docker compose restart web` | Restart the running container |

---

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| App exits on start with MySQL error | `MYSQL_*` in `.env`, TLS (`MYSQL_SSL`), Aiven/host firewall |
| Access denied for user | Reset password / grants; re-run `npm run db:init` |
| Site unreachable | `docker compose ps`, nginx config, `HOST_BIND` / firewall |
| Health check stays 503 | `docker compose logs web` — MySQL still connecting or failing |
| Published port already in use | Old PM2 process: `pm2 delete ocean-market && pm2 save` |
| Wrong client IP / rate limit | `TRUST_PROXY=true` and nginx `X-Forwarded-For` |
| Sessions drop on HTTPS | `COOKIE_SECURE=true` + `TRUST_PROXY=true` |
| No order emails | `.env` SMTP vars, Gmail App Password, server outbound 587 |
| Permission denied on uploads | `chown -R 1000:1000 public/uploads` |

---

## Alternative: run without Docker (PM2 / systemd)

The app can still run with host Node (`npm ci` + `npm start`, systemd, or [`ecosystem.config.cjs`](./ecosystem.config.cjs) + PM2). That path is no longer what production deploy uses. Prefer Docker so the host does not need Node, fnm, or a process manager.
