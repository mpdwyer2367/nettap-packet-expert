#!/usr/bin/env bash
set -euo pipefail

release_version="${NETTAP_RELEASE_VERSION:?NETTAP_RELEASE_VERSION is required}"
source_commit="${NETTAP_SOURCE_COMMIT:?NETTAP_SOURCE_COMMIT is required}"
source_tree="${NETTAP_SOURCE_TREE:?NETTAP_SOURCE_TREE is required}"
source_archive_sha="${NETTAP_SOURCE_ARCHIVE_SHA256:?NETTAP_SOURCE_ARCHIVE_SHA256 is required}"
iso_url="${NETTAP_ISO_URL:?NETTAP_ISO_URL is required}"
iso_sha="${NETTAP_ISO_SHA256:?NETTAP_ISO_SHA256 is required}"
apt_snapshot="${NETTAP_APT_SNAPSHOT:?NETTAP_APT_SNAPSHOT is required}"
target_arch="${NETTAP_ARCHITECTURE:?NETTAP_ARCHITECTURE is required}"
hypervisor="${NETTAP_HYPERVISOR:?NETTAP_HYPERVISOR is required}"
source_archive=/tmp/nettap-source.tar.gz
release_dir="/opt/nettap/releases/${release_version}"

[[ "$(id -u)" -eq 0 ]] || { echo "ERROR: installer must run as root." >&2; exit 3; }
[[ "$release_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$ ]]
[[ "$source_commit" =~ ^[0-9a-f]{40}$ && "$source_tree" =~ ^[0-9a-f]{40}$ ]]
[[ "$source_archive_sha" =~ ^[0-9a-f]{64}$ && "$iso_sha" =~ ^[0-9a-f]{64}$ ]]
[[ "$apt_snapshot" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]
[[ "$target_arch" == amd64 || "$target_arch" == arm64 ]]
[[ "$hypervisor" == virtualbox || "$hypervisor" == vmware ]]

printf '%s  %s\n' "$source_archive_sha" "$source_archive" | sha256sum --check --strict

# Ubuntu 24.04 supports archive snapshot selection natively. Pin every package
# transaction so identical source inputs do not silently resolve newer debs.
printf 'APT::Snapshot "%s";\n' "$apt_snapshot" > /etc/apt/apt.conf.d/50nettap-snapshot
export DEBIAN_FRONTEND=noninteractive
apt-get update
printf 'wireshark-common wireshark-common/install-setuid boolean false\n' | debconf-set-selections
apt-get install -y --no-install-recommends \
  age \
  auditd \
  ca-certificates \
  curl \
  docker-compose-v2 \
  docker.io \
  jq \
  openssh-server \
  openssl \
  python3 \
  tshark \
  ufw

systemctl enable --now docker
if ! id nettap-admin >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --groups sudo,docker nettap-admin
fi
passwd --lock nettap-admin

install -d -m 0755 /opt/nettap/releases
if [[ -e "$release_dir" ]]; then
  echo "ERROR: Release directory already exists: $release_dir" >&2
  exit 5
fi
install -d -m 0755 "$release_dir"
tar -xzf "$source_archive" -C "$release_dir"
chown -R root:root "$release_dir"
ln -sfn "$release_dir" /opt/nettap/current

install -d -m 0750 /etc/nettap /etc/nettap/tls
install -d -m 0700 /var/lib/nettap/state
install -d -m 0750 \
  /var/lib/nettap/ollama \
  /var/lib/nettap/open-webui \
  /var/lib/nettap/evidence \
  /var/lib/nettap/gateway/data \
  /var/lib/nettap/gateway/config \
  /var/lib/nettap/backups \
  /var/lib/nettap/reports \
  /var/log/nettap

rm -rf "${release_dir}/config/tls"
ln -s /etc/nettap/tls "${release_dir}/config/tls"
ln -s /etc/nettap/nettap.env "${release_dir}/.env"
ln -s /var/lib/nettap/state/bootstrap-admin-password "${release_dir}/.bootstrap-admin-password"
ln -s /var/lib/nettap/state/evidence-api-token "${release_dir}/.evidence-api-token"
ln -s /var/lib/nettap/state/admin-bootstrap-finalized "${release_dir}/.admin-bootstrap-finalized"
ln -s /var/lib/nettap/backups "${release_dir}/backups"
install -d -m 0755 "${release_dir}/reports"
ln -s /var/lib/nettap/reports "${release_dir}/reports/generated"

install -m 0755 "${release_dir}/scripts/nettapctl" /usr/local/sbin/nettapctl
install -m 0644 "${release_dir}/appliance/systemd/nettap-firstboot.service" /etc/systemd/system/
install -m 0644 "${release_dir}/appliance/systemd/nettap.service" /etc/systemd/system/
install -m 0640 "${release_dir}/appliance/audit/nettap.rules" /etc/audit/rules.d/nettap.rules
install -m 0644 "${release_dir}/appliance/sysctl/90-nettap.conf" /etc/sysctl.d/90-nettap.conf

cat > /etc/ssh/sshd_config.d/50-nettap.conf <<'EOF'
PermitRootLogin no
PermitEmptyPasswords no
PasswordAuthentication yes
KbdInteractiveAuthentication no
MaxAuthTries 3
X11Forwarding no
AllowUsers nettap-admin
EOF
sshd -t
sysctl --system >/dev/null
augenrules --load >/dev/null

ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp comment 'NetTAP SSH' >/dev/null
ufw allow 8443/tcp comment 'NetTAP HTTPS' >/dev/null
ufw --force enable >/dev/null

# Use a temporary build-only environment to pull immutable multi-architecture
# image digests and prepopulate the model and embedding stores. It is destroyed
# before sealing; first boot creates fresh secrets.
install -m 0600 "${release_dir}/.env.example" /etc/nettap/nettap.env
sed -i \
  -e 's/^DEPLOYMENT_MODE=.*/DEPLOYMENT_MODE=production/' \
  -e 's/^WEBUI_SECRET_KEY=.*/WEBUI_SECRET_KEY=GENERATE_ON_FIRST_START/' \
  -e 's/^WEBUI_ADMIN_PASSWORD=.*/WEBUI_ADMIN_PASSWORD=GENERATE_ON_FIRST_START/' \
  -e 's/^EVIDENCE_API_TOKEN=.*/EVIDENCE_API_TOKEN=GENERATE_ON_FIRST_START/' \
  /etc/nettap/nettap.env

"${release_dir}/scripts/lock-images.sh" --confirm

compose=(
  docker compose --project-directory "$release_dir" --env-file /etc/nettap/nettap.env
  -f "${release_dir}/compose.yaml"
  -f "${release_dir}/compose.production.yaml"
  -f "${release_dir}/compose.bootstrap.yaml"
  -f "${release_dir}/appliance/compose.appliance.yaml"
)
"${compose[@]}" up -d ollama
ready=false
for _ in $(seq 1 90); do
  if "${compose[@]}" exec -T ollama ollama list >/dev/null 2>&1; then ready=true; break; fi
  sleep 2
done
[[ "$ready" == true ]] || { echo "ERROR: Build Ollama did not become ready." >&2; exit 8; }
"${compose[@]}" exec -T ollama ollama pull "$(sed -n 's/^BASE_MODEL=//p' /etc/nettap/nettap.env)"
"${compose[@]}" --profile initialize run --rm --no-deps model-init
"${compose[@]}" --profile initialize run --rm --no-deps rag-cache-init
"${compose[@]}" down

install -m 0600 /etc/nettap/nettap.env /etc/nettap/nettap.env.locked-template
sed -i \
  -e 's/^WEBUI_SECRET_KEY=.*/WEBUI_SECRET_KEY=GENERATE_ON_FIRST_START/' \
  -e 's/^WEBUI_ADMIN_PASSWORD=.*/WEBUI_ADMIN_PASSWORD=GENERATE_ON_FIRST_START/' \
  -e 's/^EVIDENCE_API_TOKEN=.*/EVIDENCE_API_TOKEN=GENERATE_ON_FIRST_START/' \
  /etc/nettap/nettap.env.locked-template

installed_packages_sha="$(dpkg-query -W -f='${binary:Package}\t${Version}\t${Architecture}\n' | LC_ALL=C sort | sha256sum | awk '{print $1}')"
python3 - "$release_version" "$source_commit" "$source_tree" "$source_archive_sha" \
  "$iso_url" "$iso_sha" "$apt_snapshot" "$target_arch" "$hypervisor" "$installed_packages_sha" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

(release, commit, tree, archive_sha, iso_url, iso_sha, snapshot, architecture,
 hypervisor, packages_sha) = sys.argv[1:]
env = {}
for line in Path("/etc/nettap/nettap.env.locked-template").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.startswith("#"):
        key, value = line.split("=", 1)
        env[key] = value
manifest = {
    "schema_version": 1,
    "release_version": release,
    "source_commit": commit,
    "source_tree": tree,
    "source_archive_sha256": archive_sha,
    "ubuntu_iso_url": iso_url,
    "ubuntu_iso_sha256": iso_sha,
    "apt_snapshot": snapshot,
    "architecture": architecture,
    "hypervisor": hypervisor,
    "profile": {"vcpu": 6, "memory_mib": 12288, "disk_mib": 122880},
    "model_contract": "nettap-ai:0.4.0-rc.1",
    "base_model": env["BASE_MODEL"],
    "expected_base_model_id": env["EXPECTED_BASE_MODEL_ID"],
    "container_images": {
        key: env[key]
        for key in ("OLLAMA_IMAGE", "OPEN_WEBUI_IMAGE", "CADDY_IMAGE", "BACKUP_IMAGE")
    },
    "installed_packages_sha256": packages_sha,
    "created_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
}
Path("/etc/nettap/build-manifest.json").write_text(
    json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
)
PY
chmod 0644 /etc/nettap/build-manifest.json

"${release_dir}/appliance/generate-sbom.py" \
  --output /etc/nettap/sbom.cdx.json \
  --env-file /etc/nettap/nettap.env.locked-template \
  --release "$release_version" \
  --commit "$source_commit"
chmod 0644 /etc/nettap/sbom.cdx.json

rm -f /etc/nettap/nettap.env
rm -f /var/lib/nettap/state/bootstrap-admin-password \
  /var/lib/nettap/state/evidence-api-token \
  /var/lib/nettap/state/admin-bootstrap-finalized
systemctl daemon-reload
systemctl enable nettap-firstboot.service nettap.service
sync
