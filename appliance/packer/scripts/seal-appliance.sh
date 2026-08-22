#!/usr/bin/env bash
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || { echo "ERROR: sealer must run as root." >&2; exit 3; }

# Remove every clone-specific identity and disable the fixed Packer password.
# The ephemeral build key is also removed. First boot deletes the account and
# regenerates the machine ID and host keys before starting NetTAP.
passwd --lock packer >/dev/null 2>&1 || true
rm -f /home/packer/.ssh/authorized_keys /etc/sudoers.d/packer
cloud-init clean --logs --seed
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id /etc/ssh/ssh_host_*
find /var/log -type f -exec truncate -s 0 {} \;
rm -rf /var/lib/apt/lists/* /tmp/nettap-source.tar.gz
sync
shutdown -P now
