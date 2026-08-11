# Hosting Ocean Market (production)

This is a **Node.js + Express + MySQL** app. There is no separate frontend build step — you install dependencies on the server and run `npm start`.

---

## What’s in the deploy zip

| Include | Notes |
|---------|--------|
| App source (`app.js`, `mail.js`, `db.js`, …) | Yes |
| `views/`, `public/` (CSS, JS, product images) | Yes |
| `package.json` + `package-lock.json` | Yes — run `npm ci` / `npm install` **on the server** |
| `scripts/init-ocean.sql` | Database bootstrap for `ocean` |
| `.env.example` | Template — **create `.env` on the server** |
| `node_modules/` | **Not** in the zip |
| `.git/` | Not included |

---

## Server requirements

- **Linux** VPS or similar (Ubuntu 22.04+ is fine)
- **Node.js 18+** (20 LTS recommended)
- **MySQL 8.4** (or 8.0+) on the same host or a reachable DB host
- Outbound SMTP (port **587** or **465**) if you want order emails
- Optional but recommended: **nginx** (or Caddy) as reverse proxy + TLS

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

---

## 2. Install Node.js (if needed)

```bash
# Example: Node 20 via NodeSource (Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should be v18+
```

---

## 3. Install MySQL and create `ocean`

Install MySQL 8.4 on the server (see README for full APT steps), then:

```bash
cd /path/to/ocean-market
sudo mysql < scripts/init-ocean.sql
# or: mysql -u root -p < scripts/init-ocean.sql
```

That creates database **`ocean`**, user **`ocean`** / password **`ocean_pass`**, and empty tables.  
**Change the password** for production (update both MySQL and `.env`).

---

## 4. Install app dependencies

**Always install on the server** (not by copying `node_modules`):

```bash
cd /path/to/ocean-market
npm ci
# or: npm install --omit=dev
```

---

## 5. Create `.env` for production

```bash
cp .env.example .env
nano .env   # or vim
```

Minimum production settings:

```env
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
SESSION_SECRET=paste-a-long-random-string-here

TRUST_PROXY=true
COOKIE_SECURE=true

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=ocean
MYSQL_PASSWORD=your-strong-db-password
MYSQL_DATABASE=ocean
# Set true when MySQL requires or should use TLS (remote hosts, managed DBs)
MYSQL_SSL=false

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
- Use `HOST=127.0.0.1` when nginx proxies to the app on the same machine
- Use `HOST=0.0.0.0` only if you expose Node directly (not recommended without a firewall)
- Gmail app passwords: spaces optional; without spaces is simplest in `.env`
- Change `ADMIN_KEY` in `config.js` (or plan to) before going live — default is `ocean-admin-2024`

---

## 6. Test run

```bash
npm start
```

You should see something like:

```text
Ocean Market running at http://127.0.0.1:3000 (bind 127.0.0.1)
```

Visit `http://YOUR_SERVER_IP:3000` only if `HOST=0.0.0.0` and the firewall allows it. Prefer nginx (next step).

Stop with `Ctrl+C` after a smoke test.

---

## 7. Keep it running (systemd)

```bash
sudo nano /etc/systemd/system/ocean-market.service
```

```ini
[Unit]
Description=Ocean Market webstore
After=network.target mysql.service
# If your unit is named mysqld.service, use that instead of mysql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/ocean-market
Environment=NODE_ENV=production
# Loads the rest from .env via dotenv in app.js
ExecStart=/usr/bin/node app.js
Restart=on-failure
RestartSec=5

# Ensure User can write public/uploads

[Install]
WantedBy=multi-user.target
```

Adjust paths and `User`. Then:

```bash
# Example ownership if app lives in /var/www/ocean-market
sudo chown -R www-data:www-data /var/www/ocean-market

sudo systemctl daemon-reload
sudo systemctl enable --now ocean-market
sudo systemctl status ocean-market
sudo journalctl -u ocean-market -f
```

---

## 8. Reverse proxy + HTTPS (nginx)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/ocean-market
```

```nginx
server {
    listen 80;
    server_name shop.example.com;

    client_max_body_size 6M;   # product photo uploads

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

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
- `HOST=127.0.0.1`
- Restart: `sudo systemctl restart ocean-market`

---

## 9. Firewall (optional but recommended)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
# Do not expose 3000 or 3306 publicly if nginx is on 80/443 and MySQL is local
```

---

## 10. Post-deploy checklist

1. Open the storefront URL and place a **test order**
2. Confirm email arrives at `EMAIL_TO`
3. Log into admin: `/admin?key=YOUR_ADMIN_KEY`
4. Confirm product photos load
5. Confirm MySQL connection works (`mysql -u ocean -p ocean -e "SELECT COUNT(*) FROM products;"`)
6. Change the default **admin key** in `config.js` if you have not already

---

## Updating later

```bash
# Upload a new zip or rsync source files (keep .env)
cd /path/to/ocean-market
npm ci
sudo systemctl restart ocean-market
```

Back up regularly:

```bash
mysqldump -u ocean -p ocean > "backups/ocean-$(date +%F).sql"
# and public/uploads/products/
```

---

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| App exits on start with MySQL error | `MYSQL_*` in `.env`, MySQL running, `scripts/init-ocean.sql` applied |
| Access denied for user `ocean` | Re-run init script or reset password / grants |
| Site unreachable | `systemctl status ocean-market`, nginx config, `HOST` / firewall |
| Wrong client IP / rate limit | `TRUST_PROXY=true` and nginx `X-Forwarded-For` |
| Sessions drop on HTTPS | `COOKIE_SECURE=true` + `TRUST_PROXY=true` |
| No order emails | `.env` SMTP vars, Gmail App Password, server outbound 587 |
| Permission denied on uploads | `chown` app user on `public/uploads` |

---

## Quick one-liner start (no systemd)

```bash
cd /path/to/ocean-market && NODE_ENV=production npm start
```

Prefer **systemd** (section 7) or **PM2** (below) so the process survives logout and reboots.

---

## Alternative: keep it running with PM2

An example process file ships as [`ecosystem.config.cjs`](./ecosystem.config.cjs). It starts a single fork of `app.js` (do not cluster without a shared session store).

```bash
cd /path/to/ocean-market
npm ci
# ensure .env exists and MySQL is ready
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs ocean-market
pm2 save
pm2 startup   # follow the printed command (often needs sudo)
```

After an update:

```bash
cd /path/to/ocean-market
# deploy new files, keep .env
npm ci
pm2 restart ocean-market --update-env
# Prefer the ecosystem file so cwd is always the app directory:
# pm2 delete ocean-market && pm2 start ecosystem.config.cjs && pm2 save
```

Useful commands:

| Command | Purpose |
|---------|---------|
| `pm2 status` | List processes |
| `pm2 logs ocean-market` | Tail logs |
| `pm2 restart ocean-market` | Restart after deploy |
| `pm2 stop ocean-market` | Stop without deleting |
| `pm2 delete ocean-market` | Remove from PM2 |

### Reboot: PM2 online but curl to the app port fails

Typical cause: **PM2 starts before MySQL** (or wrong cwd so `.env` / `PORT` is missing). The app only calls `listen()` after a successful DB init.

The app now **retries MySQL for ~a few minutes** on boot. Still do this once on the server:

```bash
# 1) Start from the app dir with the ecosystem file (locks cwd)
cd /var/www/ocean-market   # or your REMOTE_DIR
pm2 delete ocean-market 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

# 2) Make PM2 wait for MySQL on boot (unit name is often pm2-root)
sudo systemctl edit pm2-root
```

Add:

```ini
[Unit]
After=network-online.target mysql.service mysqld.service
Wants=network-online.target
```

Then:

```bash
sudo systemctl daemon-reload
# verify after reboot:
pm2 status
pm2 logs ocean-market --lines 50 --nostream
ss -lntp | grep 4840    # or your PORT from .env
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4840/
```

If logs show MySQL errors until success, retries are working. If PORT is wrong, confirm `.env` has `PORT=4840` next to `app.js`.

Still put **nginx** in front (section 8) with `HOST=127.0.0.1`, `TRUST_PROXY=true`, and `COOKIE_SECURE=true` in `.env` for HTTPS.
