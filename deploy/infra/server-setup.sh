# Node 24 LTS (Ubuntu's apt node is too old)
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

# Caddy (official repo)
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

# app user + directory
useradd --system --create-home --shell /bin/bash grove
mkdir -p /opt/chia-grove && chown grove:grove /opt/chia-grove

# let the deploy script restart the service without a password prompt
echo 'grove ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart chia-grove' > /etc/sudoers.d/chia-grove

# grove needs your SSH key to receive deploys
mkdir -p /home/grove/.ssh && cp ~/.ssh/authorized_keys /home/grove/.ssh/
chown -R grove:grove /home/grove/.ssh && chmod 700 /home/grove/.ssh

# firewall
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable
