#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

manifest="${project_dir}/model/candidates/qwen35-9b-rc1.json"

manifest_value() {
  python3 - "$manifest" "$1" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
value = data[sys.argv[2]]
print(str(value).lower() if isinstance(value, bool) else value)
PY
}

candidate_model="$(manifest_value runtime_model)"
candidate_release="$(manifest_value release_version)"
candidate_base="$(manifest_value base_model)"
candidate_base_id="$(manifest_value expected_base_model_id)"
candidate_context="$(manifest_value num_ctx)"
source_policy="${project_dir}/$(manifest_value source_policy)"

usage() {
  cat <<EOF
NetTAP candidate-model lane

Usage:
  ./scripts/candidate-model.sh plan
  ./scripts/candidate-model.sh status
  ./scripts/candidate-model.sh build --confirm
  ./scripts/candidate-model.sh provision-profiles --confirm
  ./scripts/candidate-model.sh test
  ./scripts/candidate-model.sh compare

Candidate: ${candidate_model}
Base:      ${candidate_base} (${candidate_base_id})
Boundary:  evaluation only; RC4 remains installed and unchanged
EOF
}

generate_modelfile() {
  local destination="$1"
  python3 - "$source_policy" "$destination" "$candidate_base" "$candidate_context" <<'PY'
import re
import sys
from pathlib import Path

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
base = sys.argv[3]
context = sys.argv[4]
text = source.read_text(encoding="utf-8")
text, from_count = re.subn(r"^FROM .+$", f"FROM {base}", text, count=1, flags=re.MULTILINE)
text, context_count = re.subn(
    r"^PARAMETER num_ctx .+$",
    f"PARAMETER num_ctx {context}",
    text,
    count=1,
    flags=re.MULTILINE,
)
if from_count != 1 or context_count != 1:
    raise SystemExit("source policy does not contain exactly one replaceable FROM and num_ctx line")
destination.write_text(text, encoding="utf-8")
PY
}

require_local_deployment() {
  require_runtime
  [[ -f "$env_file" ]] || {
    echo "ERROR: Run the RC4 local deployment before using the candidate lane." >&2
    exit 3
  }
  initialize_env
  [[ "$(load_env_value DEPLOYMENT_MODE)" != production ]] || {
    echo "ERROR: Candidate evaluation is disabled in production mode." >&2
    exit 4
  }
}

candidate_installed() {
  "${compose_local[@]}" exec -T ollama ollama list | awk -v model="$candidate_model" '$1 == model {found=1} END {exit !found}'
}

command_name="${1:-help}"
shift || true

case "$command_name" in
  plan)
    [[ $# -eq 0 ]] || { usage >&2; exit 2; }
    usage
    echo
    echo "Planned controlled differences from RC4:"
    echo "  FROM ${candidate_base}"
    echo "  PARAMETER num_ctx ${candidate_context}"
    echo "  Runtime tag ${candidate_model}"
    echo "  Two non-default candidate Workspace Models"
    echo "The shared NetTAP policy, Skills, and knowledge remain unchanged."
    ;;
  status)
    [[ $# -eq 0 ]] || { usage >&2; exit 2; }
    require_local_deployment
    echo "RC4 runtime: $(load_env_value NETTAP_AI_MODEL)"
    echo "Candidate runtime: ${candidate_model}"
    if candidate_installed; then
      echo "Candidate model: installed"
      "${compose_local[@]}" exec -T ollama ollama show "$candidate_model" | sed -n '1,24p'
    else
      echo "Candidate model: not installed"
    fi
    ;;
  build)
    [[ "${1:-}" == --confirm && $# -eq 1 ]] || { usage >&2; exit 2; }
    require_local_deployment
    container_id="$("${compose_local[@]}" ps -q ollama)"
    [[ -n "$container_id" ]] || {
      echo "ERROR: RC4 Ollama is not running. Start the local deployment first." >&2
      exit 5
    }
    temporary_dir="$(mktemp -d "${project_dir}/.candidate-build.XXXXXX")"
    candidate_file="${temporary_dir}/Modelfile"
    network_name="nettap-candidate-egress-$$"
    remote_file="/tmp/nettap-candidate-${candidate_release}.Modelfile"
    cleanup() {
      docker exec "$container_id" rm -f "$remote_file" >/dev/null 2>&1 || true
      docker network disconnect -f "$network_name" "$container_id" >/dev/null 2>&1 || true
      docker network rm "$network_name" >/dev/null 2>&1 || true
      rm -rf "$temporary_dir"
    }
    trap cleanup EXIT INT TERM
    generate_modelfile "$candidate_file"
    docker network create "$network_name" >/dev/null
    docker network connect "$network_name" "$container_id"
    docker exec "$container_id" ollama pull "$candidate_base"
    actual_id="$(docker exec "$container_id" ollama list | awk -v model="$candidate_base" '$1 == model {print $2}')"
    [[ "$actual_id" == "$candidate_base_id" ]] || {
      echo "ERROR: ${candidate_base} resolved to ${actual_id:-missing}; expected ${candidate_base_id}." >&2
      echo "The public tag changed or the pull is incomplete. Candidate creation stopped." >&2
      exit 9
    }
    docker cp "$candidate_file" "${container_id}:${remote_file}" >/dev/null
    docker exec "$container_id" ollama create "$candidate_model" -f "$remote_file"
    docker exec "$container_id" ollama show "$candidate_model" >/dev/null
    echo "Candidate installed beside RC4: ${candidate_model}"
    echo "Temporary model-registry egress was removed. RC4 was not rebuilt or retagged."
    ;;
  provision-profiles)
    [[ "${1:-}" == --confirm && $# -eq 1 ]] || { usage >&2; exit 2; }
    require_local_deployment
    candidate_installed || {
      echo "ERROR: Build ${candidate_model} before provisioning profiles." >&2
      exit 5
    }
    admin_password="$(load_env_value WEBUI_ADMIN_PASSWORD)"
    if [[ -z "$admin_password" || "$admin_password" == BOOTSTRAP_RETIRED || "$admin_password" == GENERATE_ON_FIRST_START ]]; then
      [[ -t 0 ]] || {
        echo "ERROR: Run this command interactively to enter the current administrator password." >&2
        exit 7
      }
      printf 'Current Open WebUI administrator password: ' >&2
      IFS= read -r -s admin_password
      printf '\n' >&2
    fi
    printf '%s\n' "$admin_password" | python3 "${project_dir}/provisioning/provision_candidate_profiles.py" \
      --url "http://$(load_env_value BIND_ADDRESS):$(load_env_value WEB_PORT)" \
      --email "$(load_env_value WEBUI_ADMIN_EMAIL)" \
      --candidate-manifest "$manifest" \
      --password-stdin
    unset admin_password
    ;;
  test)
    [[ $# -eq 0 ]] || { usage >&2; exit 2; }
    require_local_deployment
    candidate_installed || { echo "ERROR: Candidate is not installed." >&2; exit 5; }
    NETTAP_EVAL_MODEL="$candidate_model" "${project_dir}/tests/model-behavior-eval.sh"
    ;;
  compare)
    [[ $# -eq 0 ]] || { usage >&2; exit 2; }
    require_local_deployment
    candidate_installed || { echo "ERROR: Candidate is not installed." >&2; exit 5; }
    baseline="$(load_env_value NETTAP_AI_MODEL)"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    report_dir="${project_dir}/reports/generated/model-comparison-${stamp}"
    mkdir -p "$report_dir"
    baseline_start="$(date +%s)"
    if NETTAP_EVAL_MODEL="$baseline" "${project_dir}/tests/model-behavior-eval.sh" >"${report_dir}/baseline.log" 2>&1; then
      baseline_result=PASS
    else
      baseline_result=FAIL
    fi
    baseline_seconds="$(( $(date +%s) - baseline_start ))"
    candidate_start="$(date +%s)"
    if NETTAP_EVAL_MODEL="$candidate_model" "${project_dir}/tests/model-behavior-eval.sh" >"${report_dir}/candidate.log" 2>&1; then
      candidate_result=PASS
    else
      candidate_result=FAIL
    fi
    candidate_seconds="$(( $(date +%s) - candidate_start ))"
    cat >"${report_dir}/summary.md" <<EOF
# NetTAP candidate comparison

- Generated UTC: ${stamp}
- Baseline: ${baseline}
- Candidate: ${candidate_model}
- Test suite: fourteen evidence-boundary behaviors

| Model | Result | Wall time |
|---|---:|---:|
| ${baseline} | ${baseline_result} | ${baseline_seconds}s |
| ${candidate_model} | ${candidate_result} | ${candidate_seconds}s |

This smoke comparison does not authorize promotion. Review both logs and complete factual, retrieval, security, memory, latency, macOS, Windows/WSL2, and Linux acceptance.
EOF
    cat "${report_dir}/summary.md"
    [[ "$baseline_result" == PASS && "$candidate_result" == PASS ]] || exit 1
    ;;
  help|*)
    usage
    ;;
esac
