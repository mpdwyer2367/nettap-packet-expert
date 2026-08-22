#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
[[ $# -eq 5 && "$2" == --identity && "$4" == --target-prefix ]] || {
  echo "Usage: appliance-restore.sh <backup.tar.age> --identity <age-key-file> --target-prefix <unique-prefix>" >&2
  exit 2
}
backup="$1" identity="$3" target_prefix="$5"
[[ -f "$backup" && -f "$identity" ]] || { echo "ERROR: Backup or identity file is missing." >&2; exit 3; }
[[ "$target_prefix" =~ ^[a-z0-9][a-z0-9-]{2,40}$ ]] || { echo "ERROR: Invalid target prefix." >&2; exit 2; }
command -v age >/dev/null 2>&1 || { echo "ERROR: age is required." >&2; exit 3; }
[[ "$(id -u)" -eq 0 ]] || { echo "ERROR: Encrypted restore requires root." >&2; exit 3; }
if [[ -f "${backup}.sha256" ]]; then
  (cd "$(dirname "$backup")" && sha256sum -c "$(basename "${backup}.sha256")")
fi

temporary_dir="$(mktemp -d /var/lib/nettap/state/encrypted-restore.XXXXXX)"
cleanup() { case "$temporary_dir" in /var/lib/nettap/state/encrypted-restore.*) rm -rf "$temporary_dir" ;; esac; }
trap cleanup EXIT
archive="${temporary_dir}/backup.tar"
age --decrypt --identity "$identity" --output "$archive" "$backup"
python3 - "$archive" <<'PY'
import sys, tarfile
with tarfile.open(sys.argv[1]) as archive:
    for member in archive.getmembers():
        if member.name.startswith("/") or ".." in member.name.split("/"):
            raise SystemExit(f"ERROR: Unsafe backup member: {member.name}")
        if member.isdev():
            raise SystemExit(f"ERROR: Device entry is forbidden: {member.name}")
        if member.issym() or member.islnk():
            if member.linkname.startswith("/") or ".." in member.linkname.split("/"):
                raise SystemExit(f"ERROR: Unsafe backup link: {member.name}")
PY
tar -xf "$archive" -C "$temporary_dir"
"${project_dir}/scripts/restore.sh" "${temporary_dir}/volume-backup" --target-prefix "$target_prefix"
cleanup
trap - EXIT
echo "Encrypted restore verified into isolated volumes with prefix: $target_prefix"
