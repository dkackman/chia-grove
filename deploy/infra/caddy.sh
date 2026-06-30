# systemd service (run from the repo root after cloning):
cp deploy/chia-grove.service /etc/systemd/system/chia-grove.service
systemctl daemon-reload && systemctl enable chia-grove

# Set secrets via drop-in (never commit these):
#   sudo systemctl edit chia-grove
# Add:
#   [Service]
#   Environment=AXIOM_TOKEN=your-token-here
#   Environment=GOOGLE_VISION_API_KEY=your-key-here

# Caddy: install the repo's Caddyfile (includes CSP headers + kackman.net redirect)
cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy


# 157.230.15.201

ssh grove@157.230.15.201 'journalctl -u chia-grove -n 20 --no-pager'   # expect "chia-grove server on :8080" + block lines
curl -s https://chia-grove.kackman.net/healthz                  # {"ok":true}
