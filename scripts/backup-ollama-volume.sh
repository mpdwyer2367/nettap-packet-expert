#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/common.sh"
[[ $# -eq 1 ]] || { echo "Usage: ./scripts/backup-ollama-volume.sh /approved/path/nettap-ollama-backup.tar.gz" >&2; exit 2; }
require_runtime
[[ -f "$env_file" ]] || { echo "ERROR: Deployment is not initialized." >&2; exit 3; }
output="$1"
[[ ! -e "$output" ]] || { echo "ERROR: Refusing to overwrite $output" >&2; exit 4; }
mkdir -p "$(dirname "$output")"
"${compose[@]}" exec -T ollama sh -c 'tar -C /root/.ollama -czf - .' > "$output"
shasum -a 256 "$output" > "${output}.sha256"
echo "Created local Ollama volume backup: $output"
echo "Do not commit the backup to Git. Store it in approved artifact storage with its checksum."
