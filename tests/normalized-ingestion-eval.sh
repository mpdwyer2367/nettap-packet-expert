#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/common.sh
source "${project_dir}/scripts/common.sh"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

require_runtime
[[ -f "$env_file" ]] || fail "Missing .env. Run the deployment first."
nettap_model="$(load_env_value NETTAP_AI_MODEL)"
mode="$(load_env_value DEPLOYMENT_MODE)"
if [[ "$mode" == production ]]; then
  active_compose=("${compose_production[@]}")
else
  active_compose=("${compose_local[@]}")
fi
report="${project_dir}/reports/generated/normalized-ingestion-$(date -u +%Y%m%dT%H%M%SZ).txt"
mkdir -p "$(dirname "$report")"
exec > >(tee "$report") 2>&1

run_fixture() {
  local name="$1" fixture="$2" objective="$3" response data
  shift 3
  data="$(<"${project_dir}/${fixture}")"
  echo
  echo "CASE: $name"
  response="$("${active_compose[@]}" exec -T ollama ollama run "$nettap_model" \
    "Analyze the following authorized normalized synthetic test data. It is uploaded fixture data, not a live feed. Separate observed facts from hypotheses, state material limitations, and do not invent payload or compromise. Objective: ${objective}\n\nDATA START\n${data}\nDATA END")"
  printf '%s\n' "$response"
  [[ -n "$response" ]] || fail "$name returned no output."
  while [[ $# -gt 0 ]]; do
    printf '%s\n' "$response" | grep -Eiq "$1" || fail "$name did not match required pattern: $1"
    shift
  done
  echo "PASS: $name"
}

run_fixture \
  "Normalized packet-derived evidence" \
  "tests/fixtures/normalized-pcap.json" \
  "Summarize the observed DNS, TCP, and TLS sequence and its evidence limits." \
  "uploaded|fixture|provided|normalized" \
  "DNS|example[.]com" \
  "TLS|443" \
  "no raw|no payload|cannot.*payload|not.*payload"

run_fixture \
  "Normalized security logs" \
  "tests/fixtures/normalized-logs.jsonl" \
  "Correlate the firewall and authentication events without declaring compromise." \
  "firewall|deny" \
  "authentication|credential|login" \
  "cannot confirm|insufficient|hypothesis|indicator|does not.*prove"

run_fixture \
  "Normalized IPFIX flow" \
  "tests/fixtures/normalized-ipfix.jsonl" \
  "Explain what this flow record supports and what sampling and flow data cannot prove." \
  "IPFIX|flow" \
  "sampling|1:100|sampled" \
  "template|exporter|observation" \
  "no payload|not.*payload|cannot.*payload|application.*unknown"

echo
echo "PASS: normalized PCAP-derived, log, and IPFIX fixture evaluation completed."
echo "Boundary: these are synthetic normalized examples and do not validate arbitrary parsers or live collectors."
echo "Report: $report"
