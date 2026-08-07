#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

[[ -z "$(git -C "$project_dir" status --porcelain)" ]] || {
  echo "ERROR: Model-bundle packaging requires a clean Git worktree." >&2
  exit 13
}
version="$(sed -n 's/^RELEASE_VERSION=//p' "${project_dir}/.env.example")"
model="$(sed -n 's/^NETTAP_AI_MODEL=//p' "${project_dir}/.env.example")"
base="$(sed -n 's/^BASE_MODEL=//p' "${project_dir}/.env.example")"
expected_base_id="$(sed -n 's/^EXPECTED_BASE_MODEL_ID=//p' "${project_dir}/.env.example")"
prefix="nettap-ai-model-${version}"
mkdir -p "${project_dir}/dist"
archive="${project_dir}/dist/${prefix}.tar.gz"

git -C "$project_dir" archive --format=tar.gz --prefix="${prefix}/" -o "$archive" HEAD -- \
  .env.example LICENSE NOTICE THIRD_PARTY_NOTICES.md README.md \
  model assistants skills functions knowledge provisioning/open-webui.json \
  provisioning/knowledge-sources.sha256 scripts/install-model-native.sh \
  scripts/install-model-native.ps1 scripts/verify-model-bundle.sh

(cd "${project_dir}/dist" && sha256_file "$(basename "$archive")") > "${archive}.sha256"
archive_digest="$(awk '{print $1}' "${archive}.sha256")"
{
  printf 'Artifact: %s\n' "$(basename "$archive")"
  printf 'SHA256: %s\n' "$archive_digest"
  printf 'Version: %s\n' "$version"
  printf 'Model: %s\n' "$model"
  printf 'Base: %s\n' "$base"
  printf 'Expected-Base-ID: %s\n' "$expected_base_id"
  printf 'Model-Definition-SHA256: %s\n' "$(sha256_file "${project_dir}/model/nettap-ai.Modelfile" | awk '{print $1}')"
  printf 'Provisioning-Sources-SHA256: %s\n' "$(sha256_file "${project_dir}/provisioning/knowledge-sources.sha256" | awk '{print $1}')"
  printf 'Commit: %s\n' "$(git -C "$project_dir" rev-parse HEAD)"
  printf 'Tree: %s\n' "$(git -C "$project_dir" rev-parse 'HEAD^{tree}')"
  printf 'Contains-Weights: no\n'
  printf 'Created-UTC: %s\n' "$(date -u +%FT%TZ)"
} > "${archive}.provenance.txt"

echo "$archive"
echo "The bundle contains the combined model definition, skills, and knowledge—not third-party model weights."
