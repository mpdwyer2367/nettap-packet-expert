#!/usr/bin/env bash
set -euo pipefail

[[ "${EUID}" -eq 0 ]] || { echo "ERROR: provision.sh requires root" >&2; exit 2; }
: "${NETTAP_RELEASE_VERSION:?NETTAP_RELEASE_VERSION is required}"
: "${NETTAP_ARCHITECTURE:?NETTAP_ARCHITECTURE is required}"
: "${NETTAP_SOURCE_COMMIT:?NETTAP_SOURCE_COMMIT is required}"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  auditd ca-certificates curl docker.io docker-compose-v2 jq openssh-server \
  openssl python3 qemu-guest-agent rsync sudo tshark ufw
if apt-cache show open-vm-tools >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends open-vm-tools
fi
if apt-cache show virtualbox-guest-utils >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends virtualbox-guest-utils
fi

install -d -m 0750 -o root -g root /opt/nettap/app /var/lib/nettap
tar -xzf /tmp/nettap-source.tar.gz -C /opt/nettap/app --strip-components=1
install -m 0755 /opt/nettap/app/appliance/bin/nettapctl /usr/local/sbin/nettapctl
install -m 0755 /opt/nettap/app/appliance/scripts/first-boot.sh /usr/local/libexec/nettap-first-boot
install -m 0644 /opt/nettap/app/appliance/systemd/nettap-appliance.service /etc/systemd/system/nettap-appliance.service
install -m 0644 /opt/nettap/app/appliance/systemd/nettap-firstboot.service /etc/systemd/system/nettap-firstboot.service

if ! id nettap >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --groups sudo,docker nettap
fi
passwd --lock nettap
install -d -m 0700 -o nettap -g nettap /home/nettap/.ssh

cat >/etc/ssh/sshd_config.d/60-nettap-appliance.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication yes
KbdInteractiveAuthentication no
X11Forwarding no
AllowUsers nettap
MaxAuthTries 4
LoginGraceTime 30
EOF

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'NetTAP SSH administration'
ufw allow 8443/tcp comment 'NetTAP HTTPS application'
ufw --force enable

systemctl enable docker ssh auditd qemu-guest-agent nettap-firstboot.service nettap-appliance.service
systemctl disable nettap-appliance.service

cat >/etc/nettap-release <<EOF
release=${NETTAP_RELEASE_VERSION}
architecture=${NETTAP_ARCHITECTURE}
source_commit=${NETTAP_SOURCE_COMMIT}
EOF

# Remove the temporary Packer login and create unique identity on first boot.
userdel --remove packer 2>/dev/null || true
rm -f /tmp/nettap-source.tar.gz
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id
apt-get clean
rm -rf /var/lib/apt/lists/* /var/tmp/* /tmp/*
