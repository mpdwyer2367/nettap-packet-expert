#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
report_dir="${project_dir}/reports"
mkdir -p "$report_dir"
report_file="${report_dir}/colleague-macos-acceptance-$(date -u +%Y%m%dT%H%M%SZ).txt"
exec > >(tee "$report_file") 2>&1

fail() {
  echo "FAIL: $1" >&2
  echo "Report: $report_file" >&2
  exit 1
}

echo "NetTAP Packet Expert colleague clean-room acceptance"
echo "UTC: $(date -u +%FT%TZ)"
echo "Host: $(uname -a)"
echo "Project: $project_dir"

[[ "$(uname -s)" == "Darwin" ]] || fail "This acceptance entry point requires macOS."
command -v git >/dev/null 2>&1 || fail "Git is required."
command -v docker >/dev/null 2>&1 || fail "Docker Desktop is required."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."
docker info >/dev/null 2>&1 || fail "Start Docker Desktop and wait for the engine to become ready."

origin="$(git -C "$project_dir" remote get-url origin 2>/dev/null || true)"
case "$origin" in
  https://github.com/mpdwyer2367/nettap-packet-expert.git|git@github.com:mpdwyer2367/nettap-packet-expert.git) ;;
  *) fail "Unexpected Git origin: $origin" ;;
esac

commit="$(git -C "$project_dir" rev-parse HEAD)"
branch="$(git -C "$project_dir" branch --show-current)"
echo "Origin: $origin"
echo "Branch: $branch"
echo "Commit: $commit"

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:3001 -sTCP:LISTEN >/dev/null 2>&1; then
  existing_project="$(docker ps --filter 'publish=3001' --format '{{.Label "com.docker.compose.project"}}' | head -n 1)"
  [[ "$existing_project" == "nettap-packet-expert" ]] || \
    fail "Port 3001 is already used by a non-Packet-Expert process. Run ./scripts/inventory-macos.sh before testing."
fi

"${project_dir}/tests/macos-e2e.sh"

echo
echo "AUTOMATED RESULT: PASS"
echo "Manual browser acceptance is still required at http://127.0.0.1:3001"
echo "1. On a fresh volume, sign in as admin@nettap.local with the generated local credential."
echo "2. Change it, verify the generated password fails, finalize activation, and verify the new password survives restart."
echo "3. Confirm signup is disabled and nettap-packet-expert:0.2.0-rc.1 is selected."
echo "4. Confirm four broad starter prompts appear."
echo "5. Import knowledge/NetTAP_Packet_Expert_Knowledge.md and attach it to the model."
echo "6. Confirm a knowledge question retrieves relevant guidance without claiming live data."
echo "7. Complete reports/RELEASE_ACCEPTANCE_TEMPLATE.md."
echo "Report: $report_file"

if command -v open >/dev/null 2>&1; then
  open "http://127.0.0.1:3001"
fi
