#!/usr/bin/env python3
"""Idempotently provision NetTAP knowledge and Workspace Models through Open WebUI APIs."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


class ProvisioningError(RuntimeError):
    pass


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ProvisioningError(f"required environment variable is empty: {name}")
    return value


MANIFEST_PATH = Path(os.environ.get("NETTAP_PROVISIONING_MANIFEST", "/provision/open-webui.json"))
SOURCE_ROOT = Path(os.environ.get("NETTAP_PROVISIONING_SOURCE_ROOT", "/source"))
STATE_PATH = Path(os.environ.get("NETTAP_PROVISIONING_STATE", "/app/backend/data/nettap-provisioning-state.json"))
CHECKSUM_PATH = Path(os.environ.get("NETTAP_PROVISIONING_CHECKSUMS", "/provision/knowledge-sources.sha256"))


def load_manifest() -> dict:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1:
        raise ProvisioningError("unsupported provisioning manifest schema")
    release = required_env("RELEASE_VERSION")
    if manifest.get("release_version") != release:
        raise ProvisioningError(
            f"manifest release {manifest.get('release_version')} does not match RELEASE_VERSION {release}"
        )
    return manifest


def source_path(relative: str) -> Path:
    path = (SOURCE_ROOT / relative).resolve()
    root = SOURCE_ROOT.resolve()
    if root not in path.parents or not path.is_file():
        raise ProvisioningError(f"invalid or missing provisioning source: {relative}")
    return path


def verify_source_checksums(manifest: dict) -> dict[str, str]:
    pinned = {}
    for line_number, raw in enumerate(CHECKSUM_PATH.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(None, 1)
        if len(parts) != 2 or len(parts[0]) != 64 or any(char not in "0123456789abcdef" for char in parts[0]):
            raise ProvisioningError(f"invalid source checksum line {line_number}")
        relative = parts[1].lstrip("*")
        if relative in pinned:
            raise ProvisioningError(f"duplicate pinned provisioning source: {relative}")
        pinned[relative] = parts[0]

    referenced = set()
    for collection in manifest["knowledge_collections"]:
        referenced.update(collection["files"])
    for assistant in manifest["assistants"]:
        referenced.update(assistant["system_prompt_files"])
    for skill in manifest.get("skills", []):
        referenced.add(skill["file"])
    if set(pinned) != referenced:
        raise ProvisioningError(
            f"pinned source set differs from manifest; missing={sorted(referenced - set(pinned))}, "
            f"extra={sorted(set(pinned) - referenced)}"
        )
    for relative, expected in pinned.items():
        actual = hashlib.sha256(source_path(relative).read_bytes()).hexdigest()
        if actual != expected:
            raise ProvisioningError(
                f"pinned source identity mismatch for {relative}: expected {expected}, received {actual}"
            )
    return pinned


def provisioning_fingerprint(manifest: dict) -> str:
    verify_source_checksums(manifest)
    digest = hashlib.sha256()
    digest.update(MANIFEST_PATH.read_bytes())
    digest.update(b"\0")
    digest.update(CHECKSUM_PATH.read_bytes())
    digest.update(b"\0")
    digest.update(required_env("NETTAP_AI_MODEL").encode("utf-8"))
    digest.update(b"\0")
    referenced = set()
    for collection in manifest["knowledge_collections"]:
        referenced.update(collection["files"])
    for assistant in manifest["assistants"]:
        referenced.update(assistant["system_prompt_files"])
    for skill in manifest.get("skills", []):
        referenced.add(skill["file"])
    for relative in sorted(referenced):
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(source_path(relative).read_bytes()).digest())
    return digest.hexdigest()


class ApiClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.token = None

    def request(self, method: str, path: str, payload=None, body=None, headers=None, allow=()):
        request_headers = {"Accept": "application/json"}
        if self.token:
            request_headers["Authorization"] = f"Bearer {self.token}"
        if headers:
            request_headers.update(headers)
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers=request_headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                data = response.read()
                return response.status, json.loads(data.decode("utf-8")) if data else None
        except urllib.error.HTTPError as exc:
            data = exc.read().decode("utf-8", errors="replace")
            if exc.code in allow:
                try:
                    return exc.code, json.loads(data) if data else None
                except json.JSONDecodeError:
                    return exc.code, data
            raise ProvisioningError(f"Open WebUI API {method} {path} failed with HTTP {exc.code}: {data}") from exc
        except urllib.error.URLError as exc:
            raise ProvisioningError(f"Open WebUI API {method} {path} is unavailable: {exc}") from exc

    def wait(self):
        for _ in range(90):
            try:
                status, _ = self.request("GET", "/health")
                if status == 200:
                    return
            except ProvisioningError:
                pass
            time.sleep(2)
        raise ProvisioningError("Open WebUI did not become healthy within three minutes")

    def signin(self, email: str, password: str):
        _, response = self.request(
            "POST",
            "/api/v1/auths/signin",
            {"email": email, "password": password},
        )
        if response.get("role") != "admin" or not response.get("token"):
            raise ProvisioningError("provisioning credential did not produce an administrator session")
        self.token = response["token"]

    def upload(self, knowledge_id: str, collection_key: str, release: str, relative: str):
        path = source_path(relative)
        contents = path.read_bytes()
        digest = hashlib.sha256(contents).hexdigest()
        boundary = f"----NetTAP{uuid.uuid4().hex}"
        metadata = json.dumps(
            {
                "knowledge_id": knowledge_id,
                "file_hash": digest,
                "nettap_managed_key": collection_key,
                "nettap_source_path": relative,
                "nettap_release": release,
            },
            separators=(",", ":"),
        )
        parts = []

        def add(value: bytes):
            parts.append(value)

        add(f"--{boundary}\r\n".encode())
        add(b'Content-Disposition: form-data; name="metadata"\r\n')
        add(b"Content-Type: application/json\r\n\r\n")
        add(metadata.encode("utf-8"))
        add(b"\r\n")
        add(f"--{boundary}\r\n".encode())
        add(f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'.encode())
        add(f"Content-Type: {mimetypes.guess_type(path.name)[0] or 'text/plain'}\r\n\r\n".encode())
        add(contents)
        add(b"\r\n")
        add(f"--{boundary}--\r\n".encode())
        _, response = self.request(
            "POST",
            "/api/v1/files/?process=true&process_in_background=false",
            body=b"".join(parts),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        file_id = response.get("id")
        if not file_id:
            raise ProvisioningError(f"upload did not return a file ID for {relative}")
        _, status = self.request("GET", f"/api/v1/files/{urllib.parse.quote(file_id)}/process/status")
        if status.get("status") != "completed":
            raise ProvisioningError(f"Open WebUI did not complete RAG processing for {relative}: {status}")
        return file_id, digest


def all_knowledge(client: ApiClient) -> list[dict]:
    items = []
    page = 1
    while True:
        _, response = client.request("GET", f"/api/v1/knowledge/?page={page}")
        items.extend(response.get("items", []))
        if len(items) >= int(response.get("total", len(items))):
            return items
        page += 1


def collection_files(client: ApiClient, knowledge_id: str) -> list[dict]:
    _, response = client.request("GET", f"/api/v1/knowledge/{urllib.parse.quote(knowledge_id)}/files?limit=1000")
    return response.get("items", [])


def managed_description(collection: dict, release: str, fingerprint: str) -> str:
    return (
        f"[nettap-managed:{collection['key']}] {collection['description']} "
        f"Release {release}; provisioning fingerprint {fingerprint}."
    )


def all_skills(client: ApiClient) -> list[dict]:
    _, response = client.request("GET", "/api/v1/skills/")
    if not isinstance(response, list):
        raise ProvisioningError("Open WebUI returned an invalid skill list")
    return response


def skill_content(skill: dict) -> str:
    """Return the Markdown body while retaining frontmatter in the reviewed source artifact."""
    raw = source_path(skill["file"]).read_text(encoding="utf-8")
    if not raw.startswith("---\n"):
        raise ProvisioningError(f"managed Skill source lacks YAML frontmatter: {skill['file']}")
    parts = raw.split("---\n", 2)
    if len(parts) != 3 or not parts[2].strip():
        raise ProvisioningError(f"managed Skill source has invalid YAML frontmatter: {skill['file']}")
    return parts[2].strip() + "\n"


def skill_payload(skill: dict, fingerprint: str, existing=None) -> dict:
    existing = existing or {}
    tags = list(dict.fromkeys([
        *(skill.get("tags") or []),
        "nettap-managed",
        f"nettap-key:{skill['key']}",
        f"nettap-release:{required_env('RELEASE_VERSION')}",
        f"nettap-fingerprint:{fingerprint}",
    ]))
    return {
        "id": skill["id"],
        "name": skill["name"],
        "description": skill["description"],
        "content": skill_content(skill),
        "meta": {"tags": tags},
        "is_active": True,
        "access_grants": existing.get("access_grants") or [],
    }


def reconcile_skill(client: ApiClient, skill: dict, fingerprint: str) -> dict:
    skill_id = urllib.parse.quote(skill["id"], safe="")
    status, existing = client.request("GET", f"/api/v1/skills/id/{skill_id}", allow=(404,))
    if status == 404:
        existing = None

    name_matches = [item for item in all_skills(client) if item.get("name") == skill["name"]]
    if any(item.get("id") != skill["id"] for item in name_matches):
        raise ProvisioningError(f"refusing managed skill name collision for {skill['name']}")
    if existing:
        tags = ((existing.get("meta") or {}).get("tags") or [])
        if "nettap-managed" not in tags:
            raise ProvisioningError(f"refusing to overwrite unmanaged Open WebUI Skill {skill['id']}")

    payload = skill_payload(skill, fingerprint, existing)
    if existing:
        client.request("POST", f"/api/v1/skills/id/{skill_id}/update", payload)
        action = "updated"
    else:
        client.request("POST", "/api/v1/skills/create", payload)
        action = "created"

    _, result = client.request("GET", f"/api/v1/skills/id/{skill_id}")
    if (
        result.get("name") != payload["name"]
        or result.get("description") != payload["description"]
        or result.get("content") != payload["content"]
        or result.get("is_active") is not True
        or "nettap-managed" not in ((result.get("meta") or {}).get("tags") or [])
    ):
        raise ProvisioningError(f"Open WebUI Skill {skill['id']} did not retain its managed identity")
    return {
        "key": skill["key"],
        "id": skill["id"],
        "name": skill["name"],
        "source": skill["file"],
        "sha256": hashlib.sha256(source_path(skill["file"]).read_bytes()).hexdigest(),
        "action": action,
    }


def reconcile_collection(client: ApiClient, manifest: dict, collection: dict, fingerprint: str) -> dict:
    release = manifest["release_version"]
    marker = f"[nettap-managed:{collection['key']}]"
    candidates = [item for item in all_knowledge(client) if item.get("name") == collection["name"]]
    if len(candidates) > 1:
        raise ProvisioningError(f"multiple knowledge collections use managed name {collection['name']}")
    if candidates and marker not in (candidates[0].get("description") or ""):
        raise ProvisioningError(f"refusing to overwrite unmanaged knowledge collection {collection['name']}")
    form = {
        "name": collection["name"],
        "description": managed_description(collection, release, fingerprint),
        "access_grants": (candidates[0].get("access_grants") or []) if candidates else [],
    }
    if candidates:
        knowledge = candidates[0]
        _, knowledge = client.request(
            "POST", f"/api/v1/knowledge/{urllib.parse.quote(knowledge['id'])}/update", form
        )
    else:
        _, knowledge = client.request("POST", "/api/v1/knowledge/create", form)

    expected = {}
    for relative in collection["files"]:
        path = source_path(relative)
        expected[path.name] = {"relative": relative, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}

    current = collection_files(client, knowledge["id"])
    for item in current:
        filename = item.get("filename") or (item.get("meta") or {}).get("name")
        meta = item.get("meta") or {}
        managed = meta.get("nettap_managed_key") == collection["key"]
        wanted = expected.get(filename)
        if wanted and item.get("hash") == wanted["sha256"]:
            wanted["present"] = True
            continue
        if wanted or managed:
            client.request(
                "POST",
                f"/api/v1/knowledge/{urllib.parse.quote(knowledge['id'])}/file/remove?delete_file=true",
                {"file_id": item["id"]},
            )
            continue
        raise ProvisioningError(
            f"managed collection {collection['name']} contains unmanaged file {filename}; move it before provisioning"
        )

    uploaded = []
    for filename, wanted in expected.items():
        if wanted.get("present"):
            continue
        file_id, digest = client.upload(
            knowledge["id"], collection["key"], release, wanted["relative"]
        )
        uploaded.append({"id": file_id, "filename": filename, "sha256": digest})

    final_files = collection_files(client, knowledge["id"])
    final = {item.get("filename"): item.get("hash") for item in final_files}
    wanted_final = {name: item["sha256"] for name, item in expected.items()}
    if final != wanted_final:
        raise ProvisioningError(
            f"knowledge reconciliation mismatch for {collection['name']}: expected {wanted_final}, received {final}"
        )
    return {
        "key": collection["key"],
        "id": knowledge["id"],
        "name": collection["name"],
        "files": wanted_final,
        "uploaded": uploaded,
    }


def assistant_payload(assistant: dict, knowledge: dict, skills: dict, fingerprint: str, existing=None) -> dict:
    runtime_model = required_env("NETTAP_AI_MODEL")
    prompt = "\n\n".join(source_path(path).read_text(encoding="utf-8").strip() for path in assistant["system_prompt_files"])
    existing = existing or {}
    existing_meta = existing.get("meta") or {}
    existing_grants = existing.get("access_grants") or []
    meta = {
        "profile_image_url": existing_meta.get("profile_image_url"),
        "description": assistant["description"],
        "suggestion_prompts": assistant["suggestion_prompts"],
        "tags": [{"name": tag} for tag in assistant["tags"]],
        "knowledge": [
            {"id": knowledge[key]["id"], "name": knowledge[key]["name"]}
            for key in assistant["knowledge_keys"]
        ],
        "skillIds": [skills[key]["id"] for key in assistant.get("skill_keys", [])],
        "capabilities": {
            "file_context": True,
            "vision": False,
            "file_upload": False,
            "web_search": False,
            "image_generation": False,
            "code_interpreter": False,
            "terminal": False,
            "citations": True,
            "status_updates": True,
            "memory": False,
            "builtin_tools": False,
        },
        "nettap_managed": {
            "schema_version": 1,
            "release_version": required_env("RELEASE_VERSION"),
            "fingerprint": fingerprint,
        },
    }
    if meta["profile_image_url"] is None:
        del meta["profile_image_url"]
    return {
        "id": assistant["id"],
        "base_model_id": runtime_model,
        "name": assistant["name"],
        "meta": meta,
        "params": {"system": prompt, "function_calling": "legacy"},
        "access_grants": existing_grants,
        "is_active": True,
    }


def reconcile_assistant(client: ApiClient, assistant: dict, knowledge: dict, skills: dict, fingerprint: str) -> dict:
    query = urllib.parse.urlencode({"id": assistant["id"]})
    status, existing = client.request("GET", f"/api/v1/models/model?{query}", allow=(404,))
    if status == 404:
        existing = None
    if existing:
        managed = (existing.get("meta") or {}).get("nettap_managed")
        adoptable_bases = {
            "nettap-ai:0.3.0-rc.1",
            "nettap-ai:0.3.0-rc.2",
            "nettap-ai:0.3.0-rc.3",
            "nettap-ai:0.3.0-rc.4",
            required_env("NETTAP_AI_MODEL"),
        }
        if not managed and (
            existing.get("name") != assistant["name"]
            or existing.get("base_model_id") not in adoptable_bases
        ):
            raise ProvisioningError(f"refusing to overwrite unmanaged Workspace Model {assistant['id']}")
    payload = assistant_payload(assistant, knowledge, skills, fingerprint, existing)
    if existing:
        _, result = client.request("POST", "/api/v1/models/model/update", payload)
        action = "updated"
    else:
        _, result = client.request("POST", "/api/v1/models/create", payload)
        action = "created"
    if result.get("base_model_id") != required_env("NETTAP_AI_MODEL"):
        raise ProvisioningError(f"Workspace Model {assistant['id']} did not retain the required base model")
    return {
        "id": assistant["id"],
        "name": assistant["name"],
        "action": action,
        "knowledge_ids": [item["id"] for item in payload["meta"]["knowledge"]],
        "skill_ids": payload["meta"]["skillIds"],
    }


def configure_model_defaults(client: ApiClient, manifest: dict) -> dict:
    """Make the two managed profiles easy to find without discarding admin metadata."""
    _, current = client.request("GET", "/api/v1/configs/models")
    assistant_ids = [assistant["id"] for assistant in manifest["assistants"]]
    payload = {
        "DEFAULT_MODELS": assistant_ids[0],
        "DEFAULT_PINNED_MODELS": ",".join(assistant_ids),
        "MODEL_ORDER_LIST": assistant_ids + [required_env("NETTAP_AI_MODEL")],
        "DEFAULT_MODEL_METADATA": current.get("DEFAULT_MODEL_METADATA") or {},
        "DEFAULT_MODEL_PARAMS": current.get("DEFAULT_MODEL_PARAMS") or {},
    }
    _, configured = client.request("POST", "/api/v1/configs/models", payload)
    for key in ("DEFAULT_MODELS", "DEFAULT_PINNED_MODELS", "MODEL_ORDER_LIST"):
        if configured.get(key) != payload[key]:
            raise ProvisioningError(f"Open WebUI did not retain managed model setting {key}")
    return {
        "default_model": assistant_ids[0],
        "pinned_models": assistant_ids,
        "model_order": payload["MODEL_ORDER_LIST"],
    }


def verify_embedding_and_rag(client: ApiClient, manifest: dict, knowledge: dict):
    _, config = client.request("GET", "/api/v1/retrieval/embedding")
    expected_model = manifest["embedding"]["model_path"]
    if config.get("RAG_EMBEDDING_ENGINE") != "" or config.get("RAG_EMBEDDING_MODEL") != expected_model:
        raise ProvisioningError(f"unexpected offline embedding configuration: {config}")
    collection = knowledge[manifest["embedding"]["probe_collection"]]
    _, result = client.request(
        "POST",
        "/api/v1/retrieval/query/collection",
        {
            "collection_names": [collection["id"]],
            "query": manifest["embedding"]["probe_query"],
            "k": 5,
            "hybrid": False,
        },
    )
    expected = manifest["embedding"]["probe_expected"]
    if expected not in json.dumps(result, ensure_ascii=False):
        raise ProvisioningError("offline RAG query completed but did not return the managed verification marker")
    return {"result": "PASS", "collection_id": collection["id"], "expected_marker": expected}


def write_state(state: dict):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=STATE_PATH.parent, delete=False) as handle:
        json.dump(state, handle, indent=2, sort_keys=True)
        handle.write("\n")
        temporary = Path(handle.name)
    os.chmod(temporary, 0o600)
    os.replace(temporary, STATE_PATH)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fingerprint", action="store_true")
    args = parser.parse_args()
    manifest = load_manifest()
    fingerprint = provisioning_fingerprint(manifest)
    if args.fingerprint:
        print(fingerprint)
        return 0

    password = sys.stdin.readline().rstrip("\r\n")
    if not password or password in {"BOOTSTRAP_RETIRED", "GENERATE_ON_FIRST_START"}:
        raise ProvisioningError("a current Open WebUI administrator password is required on standard input")

    client = ApiClient(required_env("OPEN_WEBUI_URL"))
    client.wait()
    client.signin(required_env("WEBUI_ADMIN_EMAIL"), password)
    del password

    knowledge = {}
    for collection in manifest["knowledge_collections"]:
        result = reconcile_collection(client, manifest, collection, fingerprint)
        knowledge[result["key"]] = result
        print(f"Knowledge ready: {result['name']} ({result['id']})")

    rag = verify_embedding_and_rag(client, manifest, knowledge)
    print("Offline RAG verification: PASS")

    skills = {}
    for skill in manifest.get("skills", []):
        result = reconcile_skill(client, skill, fingerprint)
        skills[result["key"]] = result
        print(f"Open WebUI Skill {result['action']}: {result['name']} ({result['id']})")

    assistants = []
    for assistant in manifest["assistants"]:
        result = reconcile_assistant(client, assistant, knowledge, skills, fingerprint)
        assistants.append(result)
        print(f"Workspace Model {result['action']}: {result['name']} ({result['id']})")

    model_defaults = configure_model_defaults(client, manifest)
    print("Managed Workspace Models selected and pinned")

    state = {
        "schema_version": 1,
        "release_version": manifest["release_version"],
        "runtime_model": required_env("NETTAP_AI_MODEL"),
        "fingerprint": fingerprint,
        "completed_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "knowledge": knowledge,
        "skills": skills,
        "assistants": assistants,
        "model_defaults": model_defaults,
        "offline_rag": rag,
    }
    write_state(state)
    print(f"Provisioning state: {STATE_PATH}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ProvisioningError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
