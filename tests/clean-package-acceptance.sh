#!/usr/bin/env bash
set -euo pipefail

acceptance_source="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
archive=""
evidence_dir=""
public_key=""
allow_unsigned=false

usage() {
  echo "Usage: ./tests/clean-package-acceptance.sh --archive <source.tar.gz> --evidence-dir <empty-directory> [--public-key <cosign.pub> | --allow-unsigned-evaluation]" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive) [[ $# -ge 2 ]] || usage; archive="$2"; shift 2 ;;
    --evidence-dir) [[ $# -ge 2 ]] || usage; evidence_dir="$2"; shift 2 ;;
    --public-key) [[ $# -ge 2 ]] || usage; public_key="$2"; shift 2 ;;
    --allow-unsigned-evaluation) allow_unsigned=true; shift ;;
    *) usage ;;
  esac
done
[[ -n "$archive" && -n "$evidence_dir" ]] || usage
[[ -z "$public_key" || "$allow_unsigned" == false ]] || usage
[[ -n "$public_key" || "$allow_unsigned" == true ]] || {
  echo "ERROR: Signed acceptance requires --public-key. Use --allow-unsigned-evaluation only for non-release evaluation." >&2
  exit 2
}

for command_name in docker tar curl; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "ERROR: Required command not found: $command_name" >&2; exit 3; }
done
docker compose version >/dev/null 2>&1 || { echo "ERROR: Docker Compose v2 is required." >&2; exit 3; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker engine is not running." >&2; exit 3; }

case "$(uname -s)" in
  Darwin) platform="macos" ;;
  Linux)
    if grep -Eiq 'microsoft|wsl' /proc/version; then platform="windows-wsl2"; else
      echo "ERROR: Acceptance is supported only on macOS or Windows/WSL2." >&2
      exit 3
    fi
    ;;
  *) echo "ERROR: Unsupported acceptance platform." >&2; exit 3 ;;
esac

archive="$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")"
[[ -f "$archive" ]] || { echo "ERROR: Candidate archive not found: $archive" >&2; exit 4; }
if [[ -n "$public_key" ]]; then
  public_key="$(cd "$(dirname "$public_key")" && pwd)/$(basename "$public_key")"
  "${acceptance_source}/scripts/verify-release.sh" "$archive" "$public_key"
  signature_result="PASS"
else
  "${acceptance_source}/scripts/verify-release.sh" "$archive"
  signature_result="NOT CHECKED - UNSIGNED EVALUATION"
fi

provenance="${archive}.provenance.txt"
version="$(sed -n 's/^Version: //p' "$provenance")"
source_commit="$(sed -n 's/^Commit: //p' "$provenance")"
source_tree="$(sed -n 's/^Tree: //p' "$provenance")"
package_sha256="$(sed -n 's/^SHA256: //p' "$provenance")"
[[ "$version" == "0.3.0-rc.3" ]] || { echo "ERROR: Expected package version 0.3.0-rc.3; received $version." >&2; exit 4; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ && "$source_tree" =~ ^[0-9a-f]{40}$ && "$package_sha256" =~ ^[0-9a-f]{64}$ ]] || {
  echo "ERROR: Candidate provenance is incomplete." >&2
  exit 4
}

mkdir -p "$evidence_dir"
evidence_dir="$(cd "$evidence_dir" && pwd)"
[[ -z "$(find "$evidence_dir" -mindepth 1 -print -quit)" ]] || {
  echo "ERROR: Evidence directory must be empty: $evidence_dir" >&2
  exit 4
}

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/nettap-package-acceptance.XXXXXX")"
runtime_root=""
compose_project="nettap-rc3-${platform}-${source_commit:0:8}-$$"
cleanup() {
  if [[ -n "$runtime_root" && -f "${runtime_root}/.env" ]]; then
    docker compose --project-name "$compose_project" --project-directory "$runtime_root" \
      --env-file "${runtime_root}/.env" -f "${runtime_root}/compose.yaml" \
      -f "${runtime_root}/compose.local.yaml" down -v >/dev/null 2>&1 || true
  fi
  case "$temporary_dir" in
    */nettap-package-acceptance.*) rm -rf "$temporary_dir" ;;
  esac
}
trap cleanup EXIT

tar -xzf "$archive" -C "$temporary_dir"
runtime_root="${temporary_dir}/nettap-ai-suite-${version}"
[[ -f "${runtime_root}/compose.yaml" && ! -e "${runtime_root}/.env" ]] || {
  echo "ERROR: Candidate archive layout is invalid or contains runtime state." >&2
  exit 4
}
chmod +x "${runtime_root}"/scripts/* "${runtime_root}"/tests/*.sh
export COMPOSE_PROJECT_NAME="$compose_project"
export NETTAP_SOURCE_COMMIT="$source_commit"

existing_volumes="$(docker volume ls --quiet --filter "label=com.docker.compose.project=${compose_project}")"
[[ -z "$existing_volumes" ]] || { echo "ERROR: Generated clean-room project already has volumes." >&2; exit 4; }

echo "Starting clean ${platform} acceptance for ${version}"
echo "Commit: $source_commit"
echo "Package SHA-256: $package_sha256"

# Resolve the reviewed image tags to immutable registry digests before any
# candidate container is executed. The signed release record binds the
# resulting platform identities to this source package.
"${runtime_root}/scripts/lock-images.sh" --confirm
if [[ "$platform" == macos ]]; then
  "${runtime_root}/scripts/start-macos.sh"
else
  "${runtime_root}/scripts/start-wsl2.sh"
fi

"${runtime_root}/scripts/security-scan.sh"

echo
echo "Manual credential checkpoint"
echo "1. Open http://127.0.0.1:3100 and sign in with the generated credential in ${runtime_root}/.bootstrap-admin-password."
echo "2. Change the password in Settings > Account, sign out, and verify the generated password is rejected."
printf 'Type PASSWORD-CHANGED only after completing all three actions: '
read -r credential_confirmation
[[ "$credential_confirmation" == PASSWORD-CHANGED ]] || { echo "ERROR: Administrator activation was not accepted." >&2; exit 5; }
printf 'FINALIZE\n' | "${runtime_root}/scripts/finalize-admin.sh" --confirm

if [[ "$platform" == macos ]]; then
  "${runtime_root}/scripts/verify-macos-deployment.sh"
else
  "${runtime_root}/scripts/verify-macos-deployment.sh" --windows-wsl2
fi
"${runtime_root}/tests/model-behavior-eval.sh"
"${runtime_root}/tests/normalized-ingestion-eval.sh"
"${runtime_root}/tests/model-storage-sharing.sh"
"${runtime_root}/tests/backup-restore-e2e.sh"

# shellcheck source=scripts/common.sh
source "${runtime_root}/scripts/common.sh"
before_fingerprint="$(installed_provisioning_fingerprint local)"
"${compose_local[@]}" restart ollama open-webui assistant-launcher
restart_ready=false
for _ in $(seq 1 90); do
  if curl --fail --silent --show-error "http://127.0.0.1:$(load_env_value WEB_PORT)/health" >/dev/null 2>&1; then
    restart_ready=true
    break
  fi
  sleep 2
done
[[ "$restart_ready" == true ]] || { echo "ERROR: Open WebUI failed restart acceptance." >&2; exit 6; }
[[ "$(installed_provisioning_fingerprint local)" == "$before_fingerprint" ]] || {
  echo "ERROR: Provisioning identity changed across restart." >&2
  exit 6
}
"${runtime_root}/tests/failed-update-rollback-e2e.sh"

model_lock="${runtime_root}/reports/generated/model-lock.txt"
base_model_id="$(sed -n 's/^Base model ID: //p' "$model_lock")"
nettap_model_id="$(sed -n 's/^NetTAP AI model ID: //p' "$model_lock")"
embedding_aggregate="$("${compose_local[@]}" exec -T open-webui python -c "import json; from pathlib import Path; print(json.loads(Path('/app/backend/data/nettap-embedding-model.json').read_text(encoding='utf-8'))['aggregate_sha256'])")"
provisioning_identity="$(installed_provisioning_fingerprint local)"
[[ "$base_model_id" =~ ^[0-9a-f]{12,64}$ && "$nettap_model_id" =~ ^[0-9a-f]{12,64}$ ]] || {
  echo "ERROR: Runtime model identity evidence is incomplete." >&2
  exit 6
}
[[ "$embedding_aggregate" =~ ^[0-9a-f]{64}$ && "$provisioning_identity" =~ ^[0-9a-f]{64}$ ]] || {
  echo "ERROR: Embedding or provisioning identity evidence is incomplete." >&2
  exit 6
}

echo
echo "Manual browser/profile checkpoint"
echo "1. Port 3000 must open NetTAP Network & Visibility with its three broad suggestions."
echo "2. Port 3001 must open NetTAP Packet Expert with its three evidence-focused suggestions."
echo "3. Both profiles must answer through the shared model and retrieve only their intended managed knowledge."
echo "4. Port 3100 must retain the changed administrator password after restart."
printf 'Type BROWSER-CHECKS-PASS only after completing these checks: '
read -r browser_confirmation
[[ "$browser_confirmation" == BROWSER-CHECKS-PASS ]] || { echo "ERROR: Manual browser acceptance was not completed." >&2; exit 7; }

mkdir -p "${evidence_dir}/runtime-reports"
find "${runtime_root}/reports" -maxdepth 1 -type f -name '*.txt' -exec cp {} "${evidence_dir}/runtime-reports/" \;
if [[ -d "${runtime_root}/reports/generated" ]]; then
  cp -R "${runtime_root}/reports/generated" "${evidence_dir}/generated"
fi
cp "$provenance" "${evidence_dir}/"
cp "${archive}.sha256" "${evidence_dir}/"
if [[ -f "${archive}.sig" ]]; then cp "${archive}.sig" "${evidence_dir}/"; fi
if [[ -f "${provenance}.sig" ]]; then cp "${provenance}.sig" "${evidence_dir}/"; fi

summary="${evidence_dir}/${platform}-acceptance-summary.txt"
{
  printf 'Result: PASS\n'
  printf 'Platform: %s\n' "$platform"
  printf 'Version: %s\n' "$version"
  printf 'Commit: %s\n' "$source_commit"
  printf 'Tree: %s\n' "$source_tree"
  printf 'Package: %s\n' "$(basename "$archive")"
  printf 'Package SHA256: %s\n' "$package_sha256"
  printf 'Signature verification: %s\n' "$signature_result"
  printf 'Base model ID: %s\n' "$base_model_id"
  printf 'NetTAP AI model ID: %s\n' "$nettap_model_id"
  printf 'Embedding aggregate SHA256: %s\n' "$embedding_aggregate"
  printf 'Provisioning fingerprint: %s\n' "$provisioning_identity"
  printf 'Compose project: %s\n' "$compose_project"
  printf 'Administrator credential replacement: PASS\n'
  printf 'Ports 3000, 3001 and 3100: PASS\n'
  printf 'Automatic assistants and offline RAG: PASS\n'
  printf 'Fourteen behavioral tests: PASS\n'
  printf 'Normalized PCAP, log and IPFIX examples: PASS\n'
  printf 'Shared model storage: PASS\n'
  printf 'Restart: PASS\n'
  printf 'Backup and non-overwriting restore: PASS\n'
  printf 'Failed-update rollback: PASS\n'
  printf 'SBOM and vulnerability policy: PASS\n'
  for key in OLLAMA_IMAGE OPEN_WEBUI_IMAGE CADDY_IMAGE BACKUP_IMAGE; do
    printf '%s=%s\n' "$key" "$(load_env_value "$key")"
  done
  printf 'Completed UTC: %s\n' "$(date -u +%FT%TZ)"
} > "$summary"

echo "PASS: clean ${platform} candidate acceptance completed."
echo "Evidence: $evidence_dir"
echo "Acceptance environment will now be removed; protected evidence remains."
