#!/usr/bin/env bash
# Wipe volumes + database for a clean re-record.
set -euo pipefail
cd "$(dirname "$0")"
docker compose down -v
rm -f .env.bak
echo "Reset complete. Run ./start.sh to bring AuthPlane up again."
