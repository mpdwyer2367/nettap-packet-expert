#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
candidate=false
if [[ "${1:-}" == --candidate ]]; then candidate=true; shift; fi
[[ $# -eq 4 ]] || {
  echo "Usage: ./scripts/package-appliance-bundle.sh [--candidate] <ova> <build-manifest.json> <sbom.cdx.json> <acceptance-report.md>" >&2
  exit 2
}
ova="$1" manifest="$2" sbom="$3" acceptance="$4"
for file in "$ova" "$manifest" "$sbom" "$acceptance"; do
  [[ -f "$file" ]] || { echo "ERROR: Missing bundle input: $file" >&2; exit 3; }
done

python3 - "$manifest" "$sbom" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1], encoding="utf-8"))
sbom = json.load(open(sys.argv[2], encoding="utf-8"))
assert manifest["schema_version"] == 1
assert manifest["model_contract"] == "nettap-ai:0.4.0-rc.1"
assert manifest["architecture"] in {"amd64", "arm64"}
assert manifest["hypervisor"] in {"virtualbox", "vmware"}
assert manifest["expected_base_model_id"] == "6488c96fa5fa"
assert all("@sha256:" in value for value in manifest["container_images"].values())
assert sbom["bomFormat"] == "CycloneDX" and sbom["specVersion"] == "1.5"
PY
if [[ "$candidate" == false ]] && ! grep -Fqx 'Overall result: PASS' "$acceptance"; then
  echo "ERROR: Release bundling requires a matching-hardware acceptance PASS." >&2
  exit 5
fi
if [[ "$candidate" == false ]] && ! grep -Fq 'Encrypted backup and isolated restore continuity: PASS' "$acceptance"; then
  echo "ERROR: Release bundling requires encrypted backup/restore continuity evidence." >&2
  exit 5
fi

stem="$(basename "$ova" .ova)"
bundle_dir="${project_dir}/dist/bundles/${stem}"
[[ ! -e "$bundle_dir" ]] || { echo "ERROR: Bundle already exists: $bundle_dir" >&2; exit 4; }
install -d "$bundle_dir"
cp "$ova" "${bundle_dir}/${stem}.ova"
cp "$manifest" "${bundle_dir}/build-manifest.json"
cp "$sbom" "${bundle_dir}/sbom.cdx.json"
cp "$acceptance" "${bundle_dir}/acceptance-report.md"
cp "${project_dir}/docs/APPLIANCE_IMPORT.md" "${bundle_dir}/IMPORT.md"
cp "${project_dir}/docs/APPLIANCE_FIRST_BOOT.md" "${bundle_dir}/FIRST_BOOT.md"

(cd "$bundle_dir" && shasum -a 256 \
  "${stem}.ova" build-manifest.json sbom.cdx.json acceptance-report.md IMPORT.md FIRST_BOOT.md > SHA256SUMS)
python3 - "$manifest" "$bundle_dir" "$stem" "$candidate" <<'PY'
import json, sys
from datetime import datetime, timezone
from pathlib import Path
manifest = json.load(open(sys.argv[1], encoding="utf-8"))
bundle = Path(sys.argv[2])
status = "CANDIDATE-NOT-RELEASABLE" if sys.argv[4] == "true" else "RELEASE-EVIDENCE-COMPLETE"
text = (
    f"Artifact: {sys.argv[3]}.ova\n"
    f"Status: {status}\n"
    f"Release: {manifest['release_version']}\n"
    f"Architecture: {manifest['architecture']}\n"
    f"Hypervisor: {manifest['hypervisor']}\n"
    f"Source commit: {manifest['source_commit']}\n"
    f"Git tree: {manifest['source_tree']}\n"
    f"Ubuntu ISO SHA256: {manifest['ubuntu_iso_sha256']}\n"
    f"Source archive SHA256: {manifest['source_archive_sha256']}\n"
    f"Created UTC: {datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}\n"
)
(bundle / "provenance.txt").write_text(text, encoding="utf-8")
PY
(cd "$bundle_dir" && shasum -a 256 provenance.txt >> SHA256SUMS)

if [[ -n "${COSIGN_KEY:-}" ]]; then
  command -v cosign >/dev/null 2>&1 || { echo "ERROR: COSIGN_KEY was supplied but cosign is unavailable." >&2; exit 3; }
  for file in "${stem}.ova" build-manifest.json sbom.cdx.json provenance.txt SHA256SUMS; do
    cosign sign-blob --yes --key "$COSIGN_KEY" --output-signature "${bundle_dir}/${file}.sig" "${bundle_dir}/${file}"
  done
fi
echo "$bundle_dir"
