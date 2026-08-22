#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
recipient=""
output=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --recipient) recipient="${2:-}"; shift 2 ;;
    --output) output="${2:-}"; shift 2 ;;
    *) echo "Usage: appliance-backup.sh --recipient <age-recipient> [--output <file.age>]" >&2; exit 2 ;;
  esac
done
[[ "$recipient" =~ ^age1[0-9a-z]{20,}$ ]] || { echo "ERROR: A valid age recipient is required." >&2; exit 2; }
command -v age >/dev/null 2>&1 || { echo "ERROR: age is required." >&2; exit 3; }
[[ "$(id -u)" -eq 0 ]] || { echo "ERROR: Encrypted backup requires root." >&2; exit 3; }
output="${output:-/var/lib/nettap/backups/nettap-$(date -u +%Y%m%dT%H%M%SZ).tar.age}"
[[ ! -e "$output" && ! -e "${output}.sha256" ]] || { echo "ERROR: Backup output already exists: $output" >&2; exit 4; }
install -d -m 0700 "$(dirname "$output")"
temporary_dir="$(mktemp -d /var/lib/nettap/state/encrypted-backup.XXXXXX)"
cleanup() { case "$temporary_dir" in /var/lib/nettap/state/encrypted-backup.*) rm -rf "$temporary_dir" ;; esac; }
trap cleanup EXIT

"${project_dir}/scripts/backup.sh" "${temporary_dir}/volume-backup" --confirm-stop
temporary_output="${output}.partial"
tar -C "$temporary_dir" -cf - volume-backup | age --recipient "$recipient" --output "$temporary_output"
chmod 0600 "$temporary_output"
mv "$temporary_output" "$output"
(cd "$(dirname "$output")" && sha256sum "$(basename "$output")") > "${output}.sha256"
chmod 0600 "${output}.sha256"
cleanup
trap - EXIT
echo "Encrypted backup completed: $output"
