#!/usr/bin/env bash
# Build a production deploy zip (no node_modules / .git / secrets).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="${1:-ocean-market-deploy.zip}"
STAGE="$(mktemp -d)"
NAME="ocean-market"
DEST="$STAGE/$NAME"
mkdir -p "$DEST"

echo "Staging files into $DEST ..."

# App source
cp -a app.js cart.js config.js csrf.js db.js mail.js package.json package-lock.json \
  README.md HOSTING.md .env.example .gitignore \
  Dockerfile docker-compose.yml .dockerignore \
  "$DEST/"

# MySQL bootstrap
mkdir -p "$DEST/scripts"
cp -a scripts/init-db.js scripts/init-ocean.sql scripts/pack-deploy.sh scripts/deploy.sh \
  "$DEST/scripts/" 2>/dev/null || true
if [[ -f scripts/init-db.js ]]; then
  echo "  + scripts/init-db.js"
fi
if [[ -f scripts/init-ocean.sql ]]; then
  echo "  + scripts/init-ocean.sql"
fi

# Views & public assets (including product uploads)
cp -a views "$DEST/"
mkdir -p "$DEST/public"
cp -a public/css public/js "$DEST/public/" 2>/dev/null || true
# uploads may include product images
if [[ -d public/uploads ]]; then
  cp -a public/uploads "$DEST/public/"
fi

# Ensure uploads dir exists with keepfile
mkdir -p "$DEST/public/uploads/products"
touch "$DEST/public/uploads/products/.gitkeep"

# Do NOT copy .env (secrets) or node_modules or .git
echo "Creating $OUT ..."
rm -f "$OUT"
(
  cd "$STAGE"
  zip -r -q "$ROOT/$OUT" "$NAME"
)
rm -rf "$STAGE"
echo "Done: $ROOT/$OUT"
ls -lh "$ROOT/$OUT"
unzip -l "$ROOT/$OUT" | head -60
