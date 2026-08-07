#!/usr/bin/env python3
"""Fail-closed structural checks for the production Compose profiles."""
from pathlib import Path
import sys
import yaml

root = Path(__file__).resolve().parents[1]

def load(name):
    return yaml.safe_load((root / name).read_text(encoding="utf-8"))

base = load("compose.yaml")
local = load("compose.local.yaml")
bootstrap = load("compose.bootstrap.yaml")
production = load("compose.production.yaml")

assert base["name"] == "nettap-network-intelligence"

assert set(base["services"]) == {
    "ollama", "model-init", "rag-cache-init", "open-webui", "assistant-provisioner",
    "evidence-service"
}
assert base["networks"]["backend"]["internal"] is True
assert base["networks"]["user-access"]["driver"] == "bridge"
assert base["networks"]["user-access"].get("internal") is not True
assert "ports" not in base["services"]["ollama"]
assert "ports" not in base["services"]["open-webui"]
assert local["services"]["open-webui"]["ports"] == ["${BIND_ADDRESS}:${WEB_PORT}:8080"]
assert set(local["services"]) == {"open-webui"}
assert bootstrap["services"]["ollama"]["networks"] == ["backend", "model-egress"]
assert bootstrap["services"]["rag-cache-init"]["networks"] == ["backend", "model-egress"]

rag_init = base["services"]["rag-cache-init"]
assert rag_init["profiles"] == ["initialize"]
assert rag_init["read_only"] is True
assert rag_init["cap_drop"] == ["ALL"]
assert rag_init["environment"]["RAG_EMBEDDING_MODEL_REVISION"] == "${RAG_EMBEDDING_MODEL_REVISION}"

provisioner = base["services"]["assistant-provisioner"]
assert provisioner["profiles"] == ["provision"]
assert provisioner["networks"] == ["backend"]
assert provisioner["read_only"] is True
assert provisioner["cap_drop"] == ["ALL"]
assert "ports" not in provisioner
assert provisioner["environment"]["NETTAP_PROVISIONING_CHECKSUMS"] == "/provision/knowledge-sources.sha256"
assert "./skills:/source/skills:ro" in provisioner["volumes"]
assert "./functions:/source/functions:ro" in provisioner["volumes"]

evidence_service = base["services"]["evidence-service"]
assert evidence_service["networks"] == ["backend"]
assert evidence_service["read_only"] is True
assert evidence_service["cap_drop"] == ["ALL"]
assert evidence_service["security_opt"] == ["no-new-privileges:true"]
assert "ports" not in evidence_service
assert "./case_service:/service/case_service:ro" in evidence_service["volumes"]
assert "packet-expert-evidence-data:/data" in evidence_service["volumes"]
assert evidence_service["environment"]["EVIDENCE_API_TOKEN"] == "${EVIDENCE_API_TOKEN}"
assert evidence_service["environment"]["NETTAP_EVIDENCE_MAX_UPLOAD_BYTES"] == "${EVIDENCE_MAX_UPLOAD_BYTES}"

for service_name in ("ollama", "open-webui"):
    service = base["services"][service_name]
    assert service["security_opt"] == ["no-new-privileges:true"]
    assert service["cap_drop"] == ["ALL"]
    assert service["pids_limit"] > 0
    assert service["logging"]["options"]["max-size"]

env = base["services"]["open-webui"]["environment"]
for key in (
    "ENABLE_SIGNUP",
    "ENABLE_CODE_EXECUTION",
    "ENABLE_CODE_INTERPRETER",
    "ENABLE_API_KEYS",
    "ENABLE_WEB_SEARCH",
    "ENABLE_USER_WEBHOOKS",
    "ENABLE_MEMORIES",
    "ENABLE_ADMIN_EXPORT",
    "ENABLE_ADMIN_CHAT_ACCESS",
    "BYPASS_ADMIN_ACCESS_CONTROL",
    "ENABLE_OPENAI_API",
    "ENABLE_COMMUNITY_SHARING",
    "ENABLE_DIRECT_CONNECTIONS",
    "ENABLE_RAG_LOCAL_WEB_FETCH",
    "ENABLE_SUBAGENTS",
    "USER_PERMISSIONS_CHAT_WEB_UPLOAD",
    "USER_PERMISSIONS_CHAT_EXPORT",
    "USER_PERMISSIONS_CHAT_IMPORT",
    "USER_PERMISSIONS_CHAT_SHARE",
    "USER_PERMISSIONS_CHAT_ALLOW_PUBLIC_SHARING",
    "USER_PERMISSIONS_CHAT_ALLOW_OPEN_SHARING",
    "USER_PERMISSIONS_FEATURES_DIRECT_TOOL_SERVERS",
    "USER_PERMISSIONS_FEATURES_WEB_SEARCH",
    "USER_PERMISSIONS_FEATURES_USER_WEBHOOKS",
    "USER_PERMISSIONS_FEATURES_API_KEYS",
):
    assert env[key] == "False", f"{key} must be False"
assert env["WEBUI_AUTH"] == "True"
assert env["WEBUI_NAME"] == "NetTAP Network Observability & Packet Analysis"
assert env["USER_PERMISSIONS_CHAT_FILE_UPLOAD"] == "True"
assert env["NETTAP_EVIDENCE_URL"] == "http://evidence-service:8081"
assert env["PASSWORD_HASH_ALGORITHM"] == "bcrypt"
assert env["JWT_EXPIRES_IN"] == "${JWT_EXPIRES_IN}"
assert env["ENABLE_PERSISTENT_CONFIG"] == "False"
assert env["OFFLINE_MODE"] == "True"
assert env["HF_HUB_OFFLINE"] == "1"
assert env["RAG_EMBEDDING_ENGINE"] == ""
assert env["RAG_EMBEDDING_MODEL"] == "${RAG_EMBEDDING_MODEL}"
assert env["RAG_EMBEDDING_MODEL_AUTO_UPDATE"] == "False"
assert env["RAG_EMBEDDING_MODEL_TRUST_REMOTE_CODE"] == "False"
assert env["AUDIT_LOG_LEVEL"] == "METADATA"

prod_web_env = production["services"]["open-webui"]["environment"]
assert prod_web_env["WEBUI_SESSION_COOKIE_SECURE"] == "True"
assert prod_web_env["WEBUI_AUTH_COOKIE_SECURE"] == "True"
assert prod_web_env["WEBUI_BANNERS"] == "[]"
gateway = production["services"]["gateway"]
assert gateway["ports"] == ["${HTTPS_BIND_ADDRESS}:${HTTPS_PORT}:443"]
assert gateway["networks"] == ["backend", "user-access"]
assert "./config/tls:/etc/caddy/tls:ro" in gateway["volumes"]
assert gateway["security_opt"] == ["no-new-privileges:true"]
assert gateway["depends_on"]["evidence-service"]["condition"] == "service_healthy"

env_example = (root / ".env.example").read_text(encoding="utf-8")
assert "RELEASE_VERSION=0.3.0-rc.8" in env_example
assert "BASE_MODEL=qwen3.5:9b-q4_K_M" in env_example
assert "NETTAP_AI_MODEL=nettap-ai:0.3.0-rc.8" in env_example
assert "RETIRE_LEGACY_NETTAP_MODELS=true" in env_example
assert "EXPECTED_BASE_MODEL_ID=6488c96fa5fa" in env_example
assert "NETTAP_OPERATIONS_PROFILE=nettap-network-operations" in env_example
assert "RAG_EMBEDDING_MODEL_REVISION=1110a243fdf4706b3f48f1d95db1a4f5529b4d41" in env_example
assert "WEBUI_ADMIN_PASSWORD=GENERATE_ON_FIRST_START" in env_example
assert "WEBUI_ADMIN_PASSWORD=admin" not in env_example
assert "WEBUI_ADMIN_EMAIL=admin@nettap.local" in env_example
assert "BIND_ADDRESS=127.0.0.1" in env_example
assert "EVIDENCE_PORT=" not in env_example
assert "EVIDENCE_API_TOKEN=GENERATE_ON_FIRST_START" in env_example
assert "EVIDENCE_MAX_UPLOAD_BYTES=52428800" in env_example

caddy = (root / "config/Caddyfile").read_text(encoding="utf-8")
for control in ("tls /etc/caddy/tls/tls.crt", "Strict-Transport-Security", "X-Frame-Options", "-Server"):
    assert control in caddy
assert "/system/health" in caddy
assert "NETTAP_AI_MODEL" not in caddy
for removed in ("/visibility", "/packet-expert", "/evidence", "./launchers:/srv:ro"):
    assert removed not in caddy

managed_filter = (root / "functions/nettap_evidence_ingestion.py").read_text(encoding="utf-8")
for control in ("file_handler = True", "NETTAP_EVIDENCE_URL", "EVIDENCE_API_TOKEN", "/v1/cases"):
    assert control in managed_filter

provisioner_environment = base["services"]["assistant-provisioner"]["environment"]
assert "NETTAP_EVIDENCE_TOOL_URL" not in provisioner_environment
assert "EVIDENCE_API_TOKEN" not in provisioner_environment
assert base["services"]["open-webui"]["depends_on"]["evidence-service"]["condition"] == "service_healthy"
assert base["services"]["open-webui"]["environment"]["EVIDENCE_API_TOKEN"] == "${EVIDENCE_API_TOKEN}"

workflow = (root / ".github/workflows/validate.yml").read_text(encoding="utf-8")
for profile in ("compose.local.yaml", "compose.production.yaml", "compose.bootstrap.yaml"):
    assert profile in workflow
assert "shellcheck scripts/*.sh scripts/nettap-ai scripts/nettap-packet-expert tests/*.sh" in workflow
assert "tests/test_case_service.py" in workflow
assert "tests/test_recover_open_webui_admin.py" in workflow
assert "case_service/*.py" in workflow
assert "retire-legacy-models-mock.sh" in workflow
assert "auth-bootstrap-mock.sh" in workflow
assert "admin-recovery-mock.sh" in workflow
assert "retire-legacy-models.ps1" in workflow
assert "package-model-bundle.sh" in workflow
assert "verify-model-bundle.sh" in workflow

common = (root / "scripts/common.sh").read_text(encoding="utf-8")
assert 'ensure_env_default BASE_MODEL "qwen3.5:9b-q4_K_M"' in common
assert "^BASE_MODEL=qwen3\\.5:9b$" in common
assert "retire_legacy_models_if_enabled" in common
assert 'RETIRE_LEGACY_NETTAP_MODELS "true"' in common
assert 'canonical_project_name="nettap-network-intelligence"' in common
assert 'printf \'%s\\n\' "${COMPOSE_PROJECT_NAME:-$canonical_project_name}"' in common
assert "stop_legacy_runtime_preserving_data" in common
assert "prepare_canonical_admin_bootstrap" in common

admin_recovery = (root / "scripts/recover_open_webui_admin.py").read_text(encoding="utf-8")
for control in ("bcrypt.hashpw", "BEGIN IMMEDIATE", "NETTAP_RECOVERY_ADMIN_EMAIL"):
    assert control in admin_recovery
recovery_entrypoint = (root / "scripts/recover-admin.sh").read_text(encoding="utf-8")
for control in ("source.backup", "WEBUI_SECRET_KEY", "--force-recreate open-webui", "--email"):
    assert control in recovery_entrypoint
assert "--password" not in recovery_entrypoint
assert "--password" not in admin_recovery

runtime_verifier = (root / "scripts/verify-production-deployment.sh").read_text(encoding="utf-8")
for control in ("com.docker.compose.project", ".Config.Image", "no-new-privileges:true", "EXPECTED_BASE_MODEL_ID", "NetTAP AI model ID", "strict-transport-security"):
    assert control in runtime_verifier
assert "nettap-network-operations" in runtime_verifier

restore = (root / "scripts/restore.sh").read_text(encoding="utf-8")
assert 'Release: $current_release' in restore
assert "evidence-data.tgz" in restore

backup = (root / "scripts/backup.sh").read_text(encoding="utf-8")
assert "evidence-data.tgz" in backup
assert "volume backup v3" in backup

package = (root / "scripts/package-release.sh").read_text(encoding="utf-8")
for field in ("provenance", "Commit:", "Tree:", "SHA256:"):
    assert field in package
assert "initialize_env" not in package

release_verifier = (root / "scripts/verify-release.sh").read_text(encoding="utf-8")
assert "verify-archive-tree.py" in release_verifier

acceptance = (root / "tests/clean-package-acceptance.sh").read_text(encoding="utf-8")
for control in (
    "--public-key",
    "--allow-unsigned-evaluation",
    "start-wsl2.sh",
    "model-behavior-eval.sh",
    "normalized-ingestion-eval.sh",
    "model-storage-sharing.sh",
    "backup-restore-e2e.sh",
    "failed-update-rollback-e2e.sh",
    "Signature verification: %s",
    "Base model ID: %s",
    "Embedding aggregate SHA256: %s",
):
    assert control in acceptance

certification = (root / "scripts/certify-production.sh").read_text(encoding="utf-8")
for control in ("Tree: $tree", "Package: $package_name", "Package SHA256: $package_sha256", "compare-platform-acceptance.sh"):
    assert control in certification

print("Production configuration checks passed.")
