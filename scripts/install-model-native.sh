#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
base_model="qwen2.5:7b-instruct-q4_K_M"
expected_base_id="845dbda0ea48"
model_name="nettap-ai:0.3.0-rc.3"
modelfile="${project_dir}/model/nettap-ai.Modelfile"

if [[ "${1:-}" != "--confirm-download" || $# -ne 1 ]]; then
  echo "Usage: ./scripts/install-model-native.sh --confirm-download" >&2
  echo "This downloads the pinned Qwen2.5 7B base through Ollama, verifies its ID, and creates ${model_name}." >&2
  exit 2
fi

command -v ollama >/dev/null 2>&1 || {
  echo "ERROR: Ollama is required and was not found on PATH." >&2
  echo "Install Ollama from its official distribution, start the Ollama service, and rerun this command." >&2
  exit 3
}
[[ -f "$modelfile" ]] || { echo "ERROR: Missing ${modelfile}." >&2; exit 3; }
ollama list >/dev/null 2>&1 || {
  echo "ERROR: The Ollama service is not reachable. Start Ollama and rerun this command." >&2
  exit 4
}

echo "Downloading approved base model: ${base_model}"
ollama pull "$base_model"
actual_base_id="$(ollama list | awk -v name="$base_model" '$1 == name { print $2; exit }')"
[[ -n "$actual_base_id" ]] || { echo "ERROR: Ollama did not list ${base_model} after download." >&2; exit 5; }
[[ "$actual_base_id" == "$expected_base_id" ]] || {
  echo "ERROR: Base-model identity mismatch: expected ${expected_base_id}, received ${actual_base_id}." >&2
  exit 5
}

echo "Creating combined NetTAP AI model: ${model_name}"
ollama create "$model_name" -f "$modelfile"
rendered="$(ollama show --modelfile "$model_name")"
printf '%s\n' "$rendered" | grep -Fq 'You are NetTAP AI' || {
  echo "ERROR: Combined model identity verification failed." >&2
  exit 6
}
printf '%s\n' "$rendered" | grep -Fq 'Network & Visibility mode' || {
  echo "ERROR: Network & Visibility capability is missing." >&2
  exit 6
}
printf '%s\n' "$rendered" | grep -Fq 'Packet Expert mode' || {
  echo "ERROR: Packet Expert capability is missing." >&2
  exit 6
}

echo "PASS: ${model_name} is saved in the active Ollama store."
echo "Run it directly with: ollama run ${model_name}"
echo "For both branded assistants, offline RAG, accounts, and launchers, use the full Docker deployment in README.md."
