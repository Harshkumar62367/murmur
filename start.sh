#!/usr/bin/env bash
# Murmur — bring up the AuthPlane authorization server in Docker.
# The app itself runs natively (npm run dev -- --tunnel); this script
# only handles the AS side. Run this once; leave it running.
#
# Usage:
#   ./start.sh                  # bring up AuthPlane + create demo users
#   ./start.sh --stop           # docker compose down
#   ./start.sh --reset          # wipe volumes and start fresh
set -euo pipefail

cd "$(dirname "$0")"

# ---- subcommands ----------------------------------------------------------
case "${1:-}" in
  --stop|stop)
    docker compose down
    pkill -f "cloudflared tunnel --url http://localhost:9000" 2>/dev/null || true
    echo "Stopped."
    exit 0
    ;;
  --reset|reset)
    docker compose down -v
    rm -f .env.bak
    echo "Reset complete. Run ./start.sh to bring AuthPlane up again."
    exit 0
    ;;
esac

# ---- load .env if present ------------------------------------------------
if [ -f .env ]; then
  set -a; source .env; set +a
fi

# ---- secrets -------------------------------------------------------------
: "${AUTHPLANE_ADMIN_API_KEY:=$(openssl rand -hex 32)}"
: "${AUTHPLANE_SESSION_SECRET:=$(openssl rand -hex 32)}"
export AUTHPLANE_ADMIN_API_KEY AUTHPLANE_SESSION_SECRET
grep -q '^AUTHPLANE_ADMIN_API_KEY=' .env 2>/dev/null || \
  printf 'AUTHPLANE_ADMIN_API_KEY=%s\n' "$AUTHPLANE_ADMIN_API_KEY" >> .env
grep -q '^AUTHPLANE_SESSION_SECRET=' .env 2>/dev/null || \
  printf 'AUTHPLANE_SESSION_SECRET=%s\n' "$AUTHPLANE_SESSION_SECRET" >> .env

# ---- the two URLs --------------------------------------------------------
# PUBLIC_APP_URL  = the Alpic URL the dev server prints (stable, per-account).
#                   The user runs `npm run dev -- --tunnel` in another
#                   terminal and pastes the URL here (or sets it in .env).
# PUBLIC_AUTH_URL = the cloudflared URL for :9000 (rotates on restart).

if [ -z "${PUBLIC_APP_URL:-}" ]; then
  echo ""
  echo "  +-------------------------------------------------------------+"
  echo "  | PUBLIC_APP_URL is empty.                                    |"
  echo "  |                                                             |"
  echo "  | 1. Open a second terminal:                                  |"
  echo "  |      cd murmur/murmur-app                                    |"
  echo "  |      npm install                                            |"
  echo "  |      npm run dev -- --tunnel                                |"
  echo "  |                                                             |"
  echo "  | 2. Copy the Alpic URL (e.g. https://xxx.alpic.dev)          |"
  echo "  |                                                             |"
  echo "  | 3. Paste it below, or set PUBLIC_APP_URL in .env            |"
  echo "  +-------------------------------------------------------------+"
  echo ""
  read -r -p "  Alpic URL (Enter to defer): " PUBLIC_APP_URL || true
fi
export PUBLIC_APP_URL="${PUBLIC_APP_URL%/}"

# Persist (strip any old value first)
sed -i.bak '/^PUBLIC_APP_URL=/d' .env 2>/dev/null || true
printf 'PUBLIC_APP_URL=%s\n' "$PUBLIC_APP_URL" >> .env

# ---- start cloudflared for the AS ---------------------------------------
CFD_BIN=""
if command -v cloudflared >/dev/null 2>&1; then
  CFD_BIN="$(command -v cloudflared)"
elif [ -x "./tools/cloudflared.exe" ]; then
  CFD_BIN="./tools/cloudflared.exe"
elif [ -x "./tools/cloudflared" ]; then
  CFD_BIN="./tools/cloudflared"
fi
if [ -z "$CFD_BIN" ]; then
  echo "cloudflared not found. Install it or place the binary in tools/."
  exit 1
fi
echo "-> Using cloudflared: $CFD_BIN"

if ! pgrep -f "cloudflared tunnel --url http://localhost:9000" >/dev/null; then
  echo "-> Starting cloudflared quick tunnel for :9000"
  nohup "$CFD_BIN" tunnel --url http://localhost:9000 --no-autoupdate > tools/cloudflared-auth.log 2>&1 &
  echo $! > tools/cloudflared-auth.pid
  for i in {1..40}; do
    AUTH_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' tools/cloudflared-auth.log 2>/dev/null | head -1 || true)
    [ -n "$AUTH_URL" ] && break
    sleep 1
  done
  if [ -z "$AUTH_URL" ]; then
    echo "cloudflared tunnel did not come up. Check tools/cloudflared-auth.log"
    exit 1
  fi
else
  AUTH_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' tools/cloudflared-auth.log 2>/dev/null | head -1 || true)
fi

export PUBLIC_AUTH_URL="${AUTH_URL%/}"
sed -i.bak '/^PUBLIC_AUTH_URL=/d' .env 2>/dev/null || true
printf 'PUBLIC_AUTH_URL=%s\n' "$PUBLIC_AUTH_URL" >> .env
echo "  AS tunnel: $PUBLIC_AUTH_URL"

# ---- docker compose up --------------------------------------------------
echo "-> Bringing up AuthPlane container..."
docker compose up -d

# ---- wait for /health ---------------------------------------------------
echo "-> Waiting for AuthPlane /health..."
HEALTHY=0
for i in {1..40}; do
  if curl -fsS "$PUBLIC_AUTH_URL/health" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 1
done
if [ "$HEALTHY" = "1" ]; then
  echo "  healthy at $PUBLIC_AUTH_URL"
else
  echo "  WARNING: AuthPlane did not become healthy within 40s. Check 'docker compose logs authserver'."
fi

# ---- demo users --------------------------------------------------------
echo "-> Creating demo users (idempotent)..."
for entry in "${DEMO_USER_1_EMAIL:-harsh@demo.io}:${DEMO_USER_1_PASSWORD:-speedrun-demo}:Harsh" \
             "${DEMO_USER_2_EMAIL:-maya@demo.io}:${DEMO_USER_2_PASSWORD:-speedrun-demo}:Maya"; do
  email="${entry%%:*}"; rest="${entry#*:}"; pw="${rest%%:*}"; name="${rest##*:}"
  if docker compose exec -T authserver \
       /authserver admin user create --email "$email" --name "$name" --password "$pw" >/dev/null 2>&1; then
    echo "  + $email"
  else
    echo "  . $email (exists)"
  fi
done

# ---- cheat sheet --------------------------------------------------------
cat <<EOF

-------------------------------------------------------------------
  AuthPlane AS : $PUBLIC_AUTH_URL
  Murmur app   : $PUBLIC_APP_URL/mcp
  Admin UI     : http://127.0.0.1:9001/admin/ui/
                 (paste \$AUTHPLANE_ADMIN_API_KEY when prompted)

  Demo users:
    ${DEMO_USER_1_EMAIL:-harsh@demo.io} / ${DEMO_USER_1_PASSWORD:-speedrun-demo}
    ${DEMO_USER_2_EMAIL:-maya@demo.io}  / ${DEMO_USER_2_PASSWORD:-speedrun-demo}

  Next: in a second terminal:
    cd murmur-app
    npm install
    npm run dev -- --tunnel

  Then add $PUBLIC_APP_URL/mcp as a custom connector in
  Claude (Customize -> Connectors) or ChatGPT (Profile -> Apps).

  Verify: node scripts/e2e-oauth.mjs --headless --user harsh
-------------------------------------------------------------------
EOF
