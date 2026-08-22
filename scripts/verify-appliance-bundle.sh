#!/usr/bin/env bash
set -euo pipefail

bundle_dir="${1:-}"
[[ $# -eq 1 && -d "$bundle_dir" ]] || { echo "Usage: ./scripts/verify-appliance-bundle.sh <bundle-directory>" >&2; exit 2; }
bundle_dir="$(cd "$bundle_dir" && pwd)"
for file in build-manifest.json sbom.cdx.json acceptance-report.md IMPORT.md FIRST_BOOT.md provenance.txt SHA256SUMS; do
  [[ -s "${bundle_dir}/${file}" ]] || { echo "ERROR: Missing bundle file: $file" >&2; exit 4; }
done
ova="$(find "$bundle_dir" -maxdepth 1 -type f -name '*.ova' -print -quit)"
[[ -n "$ova" ]] || { echo "ERROR: Bundle contains no OVA." >&2; exit 4; }
(cd "$bundle_dir" && shasum -a 256 -c SHA256SUMS)
grep -Fqx 'Overall result: PASS' "${bundle_dir}/acceptance-report.md" || {
  echo "ERROR: Acceptance report is not a PASS; bundle is not releasable." >&2
  exit 5
}
grep -Fq 'Encrypted backup and isolated restore continuity: PASS' "${bundle_dir}/acceptance-report.md" || {
  echo "ERROR: Acceptance report lacks recovery continuity evidence." >&2
  exit 5
}
grep -Fq 'Status: RELEASE-EVIDENCE-COMPLETE' "${bundle_dir}/provenance.txt" || {
  echo "ERROR: Provenance does not mark complete release evidence." >&2
  exit 5
}
python3 - "$bundle_dir" <<'PY'
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
manifest = json.loads((root / "build-manifest.json").read_text())
sbom = json.loads((root / "sbom.cdx.json").read_text())
assert manifest["model_contract"] == "nettap-ai:0.4.0-rc.1"
assert manifest["expected_base_model_id"] == "6488c96fa5fa"
assert all("@sha256:" in value for value in manifest["container_images"].values())
assert sbom["bomFormat"] == "CycloneDX"
PY
echo "Appliance release bundle verified: $bundle_dir"
