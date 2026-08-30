#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose down
pkill -f "cloudflared tunnel --url http://localhost:9000" 2>/dev/null || true
echo "Stopped. The dev server (npm run dev -- --tunnel) is unaffected; stop it with Ctrl+C in its terminal."
