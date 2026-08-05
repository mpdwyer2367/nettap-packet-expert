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

echo "NetTAP AI Suite colleague clean-room acceptance"
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

for port in 3000 3001 3100; do
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    existing_project="$(docker ps --filter "publish=$port" --format '{{.Label "com.docker.compose.project"}}' | head -n 1)"
    [[ "$existing_project" == "nettap-packet-expert" ]] || \
      fail "Port $port is already used by another process. Run ./scripts/inventory-macos.sh before testing."
  fi
done

"${project_dir}/tests/macos-e2e.sh"

echo
echo "AUTOMATED RESULT: PASS"
echo "Manual browser acceptance is still required at http://127.0.0.1:3000 and http://127.0.0.1:3001"
echo "1. On a fresh volume, sign in as admin@nettap.local with the generated local credential."
echo "2. Change it, verify the generated password fails, finalize activation, and verify the new password survives restart."
echo "3. Confirm signup is disabled and nettap-ai:0.3.0-rc.2 is the single NetTAP runtime model."
echo "4. Confirm port 3000 opens Network & Visibility and port 3001 opens Packet Expert."
echo "5. Confirm each launcher shows only its three intended starting points."
echo "6. Import shared knowledge for both profiles and attach each specialist collection only to its corresponding Workspace Model."
echo "7. Confirm specialist knowledge isolation and that neither profile claims unavailable live data."
echo "8. Complete reports/RELEASE_ACCEPTANCE_TEMPLATE.md."
echo "Report: $report_file"

if command -v open >/dev/null 2>&1; then
  open "http://127.0.0.1:3000"
fi
