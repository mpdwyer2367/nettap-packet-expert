#!/usr/bin/env bash
set -euo pipefail

state_dir=/var/lib/nettap
marker="${state_dir}/first-boot-complete"
credential="${state_dir}/os-bootstrap-credential"
[[ -f "$marker" ]] && exit 0

install -d -m 0700 "$state_dir"
systemd-machine-id-setup
password="Ntp!9$(openssl rand -hex 12)"
printf 'nettap:%s\n' "$password" | chpasswd
chage -d 0 nettap
umask 077
{
  printf 'Operating-system user: nettap\n'
  printf 'One-time password: %s\n' "$password"
  printf 'Generated UTC: %s\n' "$(date -u +%FT%TZ)"
} > "$credential"
chmod 0600 "$credential"

address="$(hostname -I 2>/dev/null | awk '{print $1}')"
message="NetTAP first boot\nSSH: ssh nettap@${address:-appliance-ip}\nOne-time password: ${password}\nAfter login: sudo nettapctl setup"
printf '\n%b\n\n' "$message" >/dev/tty1 2>/dev/null || true
logger -t nettap-firstboot "first boot initialized; address=${address:-unavailable}; credential displayed on console"
touch "$marker"
chmod 0600 "$marker"
unset password

