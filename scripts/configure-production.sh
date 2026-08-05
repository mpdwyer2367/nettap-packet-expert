#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

usage() {
  echo "Usage: ./scripts/configure-production.sh --hostname <dns-name> --certificate <pem> --private-key <pem>" >&2
  exit 2
}

hostname="" certificate="" private_key=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hostname) hostname="${2:-}"; shift 2 ;;
    --certificate) certificate="${2:-}"; shift 2 ;;
    --private-key) private_key="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[[ -n "$hostname" && -f "$certificate" && -f "$private_key" ]] || usage
[[ "$hostname" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "ERROR: Invalid hostname." >&2; exit 3; }

require_command openssl
require_command python3
openssl x509 -in "$certificate" -noout -checkend 86400 >/dev/null || {
  echo "ERROR: Certificate is invalid or expires within 24 hours." >&2
  exit 4
}
python3 - "$certificate" "$hostname" <<'PY'
import ssl
import sys
import ipaddress

certificate = ssl._ssl._test_decode_cert(sys.argv[1])
subject_alt_names = certificate.get("subjectAltName", ())
if not subject_alt_names:
    raise SystemExit("ERROR: Certificate has no Subject Alternative Name.")
hostname = sys.argv[2].encode("idna").decode("ascii").lower().rstrip(".")
try:
    requested_ip = ipaddress.ip_address(hostname)
except ValueError:
    requested_ip = None
matched = False
for kind, value in subject_alt_names:
    if requested_ip is not None and kind == "IP Address":
        try:
            matched = ipaddress.ip_address(value) == requested_ip
        except ValueError:
            pass
    elif requested_ip is None and kind == "DNS":
        pattern = value.encode("idna").decode("ascii").lower().rstrip(".")
        matched = hostname == pattern
        if pattern.startswith("*."):
            matched = hostname.endswith(pattern[1:]) and hostname.count(".") == pattern.count(".")
    if matched:
        break
if not matched:
    raise SystemExit("ERROR: Certificate Subject Alternative Name does not match the requested hostname.")
PY
openssl pkey -in "$private_key" -passin pass: -noout >/dev/null 2>&1 || {
  echo "ERROR: Private key is invalid or encrypted. Supply an unencrypted deployment key protected by file permissions." >&2
  exit 4
}
cert_pub="$(openssl x509 -in "$certificate" -pubkey -noout | openssl pkey -pubin -outform der 2>/dev/null | openssl dgst -sha256)"
key_pub="$(openssl pkey -in "$private_key" -passin pass: -pubout -outform der 2>/dev/null | openssl dgst -sha256)"
[[ "$cert_pub" == "$key_pub" ]] || { echo "ERROR: Certificate and private key do not match." >&2; exit 4; }

initialize_env
install -d -m 0700 "${project_dir}/config/tls"
install -m 0644 "$certificate" "${project_dir}/config/tls/tls.crt"
install -m 0600 "$private_key" "${project_dir}/config/tls/tls.key"
set_env_value APPLIANCE_HOSTNAME "$hostname"
set_env_value DEPLOYMENT_MODE production
echo "Production TLS material installed for $hostname. Run lock-images.sh, security-scan.sh, and start-production.sh."
