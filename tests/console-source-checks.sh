#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

required=(
  console/Dockerfile
  console/package-lock.json
  console/src/lib/managed-ollama.server.ts
  console/src/routes/api/nettap/ollama.chat.ts
  compose.console.yaml
  config/Console.Caddyfile
  scripts/start-console.sh
)
for path in "${required[@]}"; do
  [[ -f "$path" ]] || { echo "Missing console integration file: $path" >&2; exit 1; }
done

grep -q 'model: "nettap-ai:0.4.0-rc.1"' console/src/lib/ollama.ts
grep -q 'body: JSON.stringify({ name: managedModel() })' console/src/routes/api/nettap/ollama.show.ts
grep -q 'model: managedModel()' console/src/lib/managed-ollama.server.ts
grep -q 'Hosted inference is disabled' console/src/routes/api/chat.ts
grep -q 'OLLAMA_BASE_URL: http://ollama:11434' compose.console.yaml
grep -q 'cap_drop: \[ALL\]' compose.console.yaml
grep -q '^USER node$' console/Dockerfile
grep -q '^ARG NODE_IMAGE=.*@sha256:' console/Dockerfile

[[ ! -e console/.env ]] || { echo "Imported console environment file must not be tracked." >&2; exit 1; }
[[ -z "$(find console/.lovable -type f -print -quit 2>/dev/null)" ]] || {
  echo "Lovable planning instructions must not ship as runtime source." >&2
  exit 1
}
[[ ! -e console/AGENTS.md ]] || { echo "Nested Lovable agent instructions must not ship in NetTAP." >&2; exit 1; }

if rg -n 'ai\.gateway\.lovable\.dev|mpdwyer/nettap-packet-expert' console/src; then
  echo "Console runtime still contains a hosted AI gateway or legacy model reference." >&2
  exit 1
fi
if rg -n '11434:11434|ports:.*11434' compose.console.yaml; then
  echo "Console overlay publishes the Ollama API." >&2
  exit 1
fi
if rg -n '^ARG .*(_KEY|_TOKEN|_SECRET)' console/Dockerfile; then
  echo "Console Docker build accepts a credential-shaped argument." >&2
  exit 1
fi

bash -n scripts/start-console.sh
echo "Console source checks passed."
