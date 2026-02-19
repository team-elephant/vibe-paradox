#!/usr/bin/env bash
# deploy/setup.sh — First-time server setup on a fresh Ubuntu VPS
# Run as root: bash setup.sh

set -euo pipefail

echo "=== Vibe Paradox — Server Setup ==="

# --- System packages ---
apt-get update
apt-get install -y curl build-essential python3

# --- Create 'vibe' user ---
if ! id -u vibe &>/dev/null; then
  useradd -m -s /bin/bash vibe
  echo "Created user 'vibe'"
else
  echo "User 'vibe' already exists"
fi

# --- Install Node.js 20 LTS via nvm (as vibe user) ---
su - vibe -c '
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm alias default 20
'

# --- Create directories ---
mkdir -p /opt/vibe-paradox
mkdir -p /var/lib/vibe-paradox
chown vibe:vibe /opt/vibe-paradox
chown vibe:vibe /var/lib/vibe-paradox

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Copy project files to /opt/vibe-paradox"
echo "  2. Run as vibe: cd /opt/vibe-paradox && npm install --production && npm run build"
echo "  3. Copy deploy/vibe-paradox.service to /etc/systemd/system/"
echo "  4. systemctl daemon-reload && systemctl enable --now vibe-paradox"
