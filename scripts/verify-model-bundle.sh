#!/usr/bin/env bash
set -euo pipefail

archive="${1:-}"
[[ -f "$archive" && -f "${archive}.sha256" && -f "${archive}.provenance.txt" ]] || {
  echo "Usage: ./scripts/verify-model-bundle.sh <nettap-ai-model-*.tar.gz>" >&2
  exit 2
}
archive_dir="$(cd "$(dirname "$archive")" && pwd)"
archive_name="$(basename "$archive")"
provenance="${archive}.provenance.txt"

(cd "$archive_dir" && if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c "${archive_name}.sha256"
else
  sha256sum -c "${archive_name}.sha256"
fi)
archive_digest="$(if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$archive"; else sha256sum "$archive"; fi | awk '{print $1}')"
grep -Fqx "Artifact: $archive_name" "$provenance"
grep -Fqx "SHA256: $archive_digest" "$provenance"
grep -Fqx 'Model: nettap-ai:0.3.0-rc.4' "$provenance"
grep -Fqx 'Base: qwen2.5:7b-instruct-q4_K_M' "$provenance"
grep -Fqx 'Expected-Base-ID: 845dbda0ea48' "$provenance"
grep -Fqx 'Contains-Weights: no' "$provenance"

temporary_base="${TMPDIR:-$archive_dir}"
if [[ ! -d "$temporary_base" || ! -w "$temporary_base" ]]; then
  temporary_base="$archive_dir"
fi
temporary="$(mktemp -d "${temporary_base%/}/nettap-model-verify.XXXXXXXX")"
trap 'rm -rf "$temporary"' EXIT
python3 - "$archive" <<'PY'
import sys
import tarfile
from pathlib import PurePosixPath

with tarfile.open(sys.argv[1], "r:gz") as archive:
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts or member.issym() or member.islnk():
            raise SystemExit(f"unsafe archive member: {member.name}")
        if member.isfile() and member.size > 100 * 1024 * 1024:
            raise SystemExit(f"unexpected large file: {member.name}")
PY
tar -xzf "$archive" -C "$temporary"
bundle_root="${temporary}/${archive_name%.tar.gz}"
[[ -f "${bundle_root}/model/nettap-ai.Modelfile" ]]
[[ -f "${bundle_root}/model/MODEL_CARD.md" ]]
[[ -f "${bundle_root}/skills/nettap-network-visibility/SKILL.md" ]]
[[ -f "${bundle_root}/skills/nettap-packet-expert/SKILL.md" ]]
[[ -f "${bundle_root}/scripts/install-model-native.sh" ]]
model_digest="$(if command -v shasum >/dev/null 2>&1; then shasum -a 256 "${bundle_root}/model/nettap-ai.Modelfile"; else sha256sum "${bundle_root}/model/nettap-ai.Modelfile"; fi | awk '{print $1}')"
sources_digest="$(if command -v shasum >/dev/null 2>&1; then shasum -a 256 "${bundle_root}/provisioning/knowledge-sources.sha256"; else sha256sum "${bundle_root}/provisioning/knowledge-sources.sha256"; fi | awk '{print $1}')"
grep -Fqx "Model-Definition-SHA256: $model_digest" "$provenance"
grep -Fqx "Provisioning-Sources-SHA256: $sources_digest" "$provenance"
(cd "$bundle_root" && if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c provisioning/knowledge-sources.sha256
else
  sha256sum -c provisioning/knowledge-sources.sha256
fi)
grep -Fq 'You are the NetTAP Network Intelligence Model' "${bundle_root}/model/nettap-ai.Modelfile"
grep -Fq 'Network & Visibility mode' "${bundle_root}/model/nettap-ai.Modelfile"
grep -Fq 'Packet Expert mode' "${bundle_root}/model/nettap-ai.Modelfile"
echo "PASS: NetTAP Network Intelligence Model bundle verified."
