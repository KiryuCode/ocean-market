#!/usr/bin/env bash
# Deploy Ocean Market over SSH as a Docker Compose stack.
# Required env: HOST, REMOTE_USER, REMOTE_DIR
# Optional: SSH_KEY
set -euo pipefail

HOST="${HOST:?HOST is required}"
REMOTE_USER="${REMOTE_USER:?REMOTE_USER is required}"
REMOTE_DIR="${REMOTE_DIR:?REMOTE_DIR is required}"
SSH_KEY="${SSH_KEY:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [ -n "$SSH_KEY" ]; then
  SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes)
elif [ -f "$HOME/.ssh/deploy_key" ]; then
  SSH_OPTS=(-i "$HOME/.ssh/deploy_key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes)
fi

ssh_cmd() { ssh "${SSH_OPTS[@]}" "$@"; }
rsync_ssh() { printf 'ssh'; for o in "${SSH_OPTS[@]}"; do printf ' %q' "$o"; done; }

echo "==> Rsync to ${REMOTE_USER}@${HOST}:${REMOTE_DIR}"
ssh_cmd "${REMOTE_USER}@${HOST}" "mkdir -p $(printf '%q' "$REMOTE_DIR")"

# Never overwrite .env or product uploads on the server
rsync -avz \
  -e "$(rsync_ssh)" \
  --exclude node_modules \
  --exclude .env \
  --exclude .git \
  --exclude .github \
  --exclude local.db \
  --exclude local.db-shm \
  --exclude local.db-wal \
  --exclude public/uploads \
  --exclude ecosystem.config.cjs \
  app.js \
  cart.js \
  config.js \
  db.js \
  mail.js \
  package.json \
  package-lock.json \
  Dockerfile \
  docker-compose.yml \
  .dockerignore \
  .env.example \
  views \
  public \
  scripts \
  "${REMOTE_USER}@${HOST}:${REMOTE_DIR}/"

echo "==> Install Docker stack on server"
ssh_cmd "${REMOTE_USER}@${HOST}" \
  REMOTE_DIR="$REMOTE_DIR" \
  bash -s <<'EOF'
set -euo pipefail
cd "${REMOTE_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing docker.io + docker-compose-v2"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y docker.io docker-compose-v2
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose plugin not found. Install docker-compose-v2."
  exit 1
fi

upsert_env() {
  local key="$1" value="$2"
  [ -n "$value" ] || return 0
  touch .env
  if grep -qE "^[[:space:]]*${key}=" .env; then
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" '
      BEGIN { done=0 }
      $0 ~ "^[[:space:]]*"k"=" { print k"="v; done=1; next }
      { print }
      END { if (!done) print k"="v }
    ' .env > "$tmp"
    mv "$tmp" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

if [ ! -f .env ]; then
  echo "==> Seeding .env from .env.example"
  cp .env.example .env
  echo "WARNING: ${REMOTE_DIR}/.env was just created — set MYSQL_*, SESSION_SECRET, SMTP, SITE_URL before relying on this deploy"
fi

# Published port stays on loopback so nginx is the only public entry.
upsert_env HOST_BIND 127.0.0.1
upsert_env NODE_ENV production

# SEO origin was left at the loopback URL from the PM2 era.
if grep -qE '^[[:space:]]*SITE_URL=http://127\.0\.0\.1' .env; then
  upsert_env SITE_URL https://adavis.shop
fi

mkdir -p public/uploads/products
# Container runs as uid 1000 (node) and must write uploaded product photos.
chown -R 1000:1000 public/uploads
chmod 600 .env

echo "==> Retiring PM2 process (if present)"
export PATH="/usr/local/bin:/usr/bin:$HOME/.local/bin:$PATH"
if command -v pm2 >/dev/null 2>&1 && pm2 describe ocean-market >/dev/null 2>&1; then
  pm2 delete ocean-market
  # Empty list still needs --force so a reboot does not restore the old dump
  pm2 save --force || true
fi

if command -v nginx >/dev/null 2>&1 && [ -f /etc/nginx/nginx.conf ]; then
  echo "==> Hide nginx version (server_tokens off)"
  # A second server_tokens in conf.d is a duplicate and fails nginx -t.
  rm -f /etc/nginx/conf.d/ocean-market-security.conf
  if grep -qE '^[[:space:]]*server_tokens[[:space:]]+' /etc/nginx/nginx.conf; then
    sed -i -E 's/^[[:space:]]*server_tokens[[:space:]]+[^;]+;/    server_tokens off;/' \
      /etc/nginx/nginx.conf
  else
    sed -i '/^http {/a\    server_tokens off;' /etc/nginx/nginx.conf
  fi
  if nginx -t; then
    systemctl reload nginx
  else
    echo "WARNING: nginx -t failed; did not reload nginx"
  fi
fi

echo "==> docker compose up --build"
docker compose up --build -d --remove-orphans
docker compose ps

APP_PORT=3000
if [ -f .env ]; then
  ENV_PORT="$(grep -E '^[[:space:]]*PORT=' .env | tail -1 | cut -d= -f2- | tr -d '[:space:]' | tr -d \"\' || true)"
  if [ -n "${ENV_PORT:-}" ] && [[ "$ENV_PORT" =~ ^[0-9]+$ ]]; then
    APP_PORT="$ENV_PORT"
  fi
fi
HEALTH_URL="http://127.0.0.1:${APP_PORT}/healthz"
echo "==> Health check ${HEALTH_URL}"
ok=0
for i in $(seq 1 30); do
  sleep 2
  code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 5 "$HEALTH_URL" || true)"
  echo "  attempt ${i}: HTTP ${code:-000}"
  if [ "$code" = "200" ]; then
    ok=1
    break
  fi
done
if [ "$ok" -ne 1 ]; then
  echo "Health check failed."
  docker compose logs --tail 80 || true
  exit 1
fi
echo "Deploy complete."
EOF
