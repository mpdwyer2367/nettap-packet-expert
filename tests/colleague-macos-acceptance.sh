#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
report_dir="${project_dir}/reports"
mkdir -p "$report_dir"
report_file="${report_dir}/colleague-macos-acceptance-$(date -u +%Y%m%dT%H%M%SZ).txt"
exec > >(tee "$report_file") 2>&1
fail() { echo "FAIL: $1" >&2; echo "Report: $report_file" >&2; exit 1; }

[[ "$(uname -s)" == Darwin ]] || fail "macOS host required."
for command_name in git docker; do command -v "$command_name" >/dev/null || fail "$command_name is required."; done
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."
docker info >/dev/null 2>&1 || fail "Start Docker Desktop."

origin="$(git -C "$project_dir" remote get-url origin 2>/dev/null || true)"
case "$origin" in
  https://github.com/mpdwyer2367/nettap-packet-expert.git|git@github.com:mpdwyer2367/nettap-packet-expert.git) ;;
  *) fail "Unexpected Git origin: $origin" ;;
esac
echo "Commit: $(git -C "$project_dir" rev-parse HEAD)"
"${project_dir}/tests/macos-e2e.sh"

echo "AUTOMATED RESULT: PASS"
echo "Manual acceptance at http://127.0.0.1:3100:"
echo "1. Complete generated-password replacement and finalization."
echo "2. Confirm signup is disabled and the combined assistant is selected by default."
echo "3. Test a network-design question and a troubleshooting question."
echo "4. Attach authorized representative PCAP, log and normalized-flow files and verify cited evidence, quality warnings and limitations."
echo "5. Confirm ports 3000, 3001 and 3200 are not listening."
echo "6. Complete reports/RELEASE_ACCEPTANCE_TEMPLATE.md."
echo "Report: $report_file"

if command -v open >/dev/null 2>&1; then open "http://127.0.0.1:3100"; fi
