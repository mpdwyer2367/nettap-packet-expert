#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$project_dir/.env"
test -f "$env_file" || { echo "Run the platform start script first." >&2; exit 1; }

project_name="nettap-packet-expert"
container="${project_name}-open-webui-1"
if ! docker inspect "$container" >/dev/null 2>&1; then
  container="$(docker compose --project-directory "$project_dir" --env-file "$env_file" -f "$project_dir/compose.yaml" -f "$project_dir/compose.local.yaml" ps -q open-webui)"
fi
test -n "$container" || { echo "Open WebUI container is not running." >&2; exit 1; }

docker cp "$project_dir/openwebui" "$container:/tmp/nettap-openwebui"
docker cp "$project_dir/scripts/install-openwebui-model.py" "$container:/tmp/install-openwebui-model.py"
docker cp "$project_dir/scripts/install-openwebui-skill.py" "$container:/tmp/install-openwebui-skill.py"
docker exec "$container" python /tmp/install-openwebui-model.py \
  /tmp/nettap-openwebui/models/nettap-pcap-expert.json
docker exec "$container" python /tmp/install-openwebui-skill.py \
  /tmp/nettap-openwebui/skills
echo "Packet Expert workspace model, skill, and six model-specific suggestions installed."
echo "Import knowledge/NetTAP_Packet_Expert_Knowledge.md as documented in the manual."
