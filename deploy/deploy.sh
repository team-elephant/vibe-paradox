#!/usr/bin/env bash
# deploy/deploy.sh — Push updates to VPS
# Usage: ./deploy/deploy.sh <VPS_IP>

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <VPS_IP>"
  echo "Example: $0 123.45.67.89"
  exit 1
fi

VPS_IP="$1"
REMOTE_DIR="/opt/vibe-paradox"
SSH_USER="root"

echo "=== Deploying to ${VPS_IP} ==="

# --- Sync project files ---
rsync -avz --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude '*.db' \
  --exclude '*.db-shm' \
  --exclude '*.db-wal' \
  --exclude .claude \
  -e ssh \
  ./ "${SSH_USER}@${VPS_IP}:${REMOTE_DIR}/"

# --- Fix ownership, install, build, restart ---
ssh "${SSH_USER}@${VPS_IP}" << 'REMOTE'
  set -euo pipefail
  chown -R vibe:vibe /opt/vibe-paradox

  su - vibe -c '
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    cd /opt/vibe-paradox
    npm install
    npm run build
    npm prune --omit=dev
  '

  # Symlink migrations into dist/ (tsup doesn't bundle .sql files)
  mkdir -p /opt/vibe-paradox/dist/db
  ln -sf /opt/vibe-paradox/db/migrations /opt/vibe-paradox/dist/db/migrations

  # Copy dashboard.html into dist/ (tsup doesn't bundle .html files)
  mkdir -p /opt/vibe-paradox/dist/src/server
  cp /opt/vibe-paradox/src/server/dashboard.html /opt/vibe-paradox/dist/src/server/dashboard.html

  # Open admin dashboard port
  ufw allow 8081/tcp 2>/dev/null || true

  systemctl restart vibe-paradox
  echo "=== Deploy complete. Server restarted. ==="
REMOTE
