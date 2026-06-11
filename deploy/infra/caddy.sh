# paste the repo's deploy/chia-grove.service:
curl -fsSL https://raw.githubusercontent.com/dkackman/chia-grove/main/deploy/chia-grove.service \
  -o /etc/systemd/system/chia-grove.service
systemctl daemon-reload && systemctl enable chia-grove

# Caddy: replace the placeholder domain
printf 'chia-grove.kackman.net {\n    reverse_proxy localhost:8080\n}\n' > /etc/caddy/Caddyfile
systemctl reload caddy


# 157.230.15.201

ssh grove@157.230.15.201 'journalctl -u chia-grove -n 20 --no-pager'   # expect "chia-grove server on :8080" + block lines
curl -s https://chia-grove.kackman.net/healthz                  # {"ok":true}
