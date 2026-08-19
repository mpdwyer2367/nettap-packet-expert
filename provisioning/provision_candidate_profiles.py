#!/usr/bin/env python3
"""Create isolated, non-default Qwen candidate profiles in an existing RC4 Open WebUI."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request


class CandidateProvisioningError(RuntimeError):
    pass


ROOT = Path(__file__).resolve().parents[1]
PRODUCT_MANIFEST = ROOT / "provisioning/open-webui.json"


class ApiClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.token: str | None = None

    def request(self, method: str, path: str, payload=None, allow=()):
        headers = {"Accept": "application/json"}
        data = None
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
                return response.status, json.loads(body.decode("utf-8")) if body else None
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            if exc.code in allow:
                try:
                    return exc.code, json.loads(body) if body else None
                except json.JSONDecodeError:
                    return exc.code, body
            raise CandidateProvisioningError(
                f"Open WebUI API {method} {path} failed with HTTP {exc.code}: {body}"
            ) from exc
        except urllib.error.URLError as exc:
            raise CandidateProvisioningError(f"Open WebUI is unavailable: {exc}") from exc

    def signin(self, email: str, password: str):
        _, result = self.request(
            "POST", "/api/v1/auths/signin", {"email": email, "password": password}
        )
        if result.get("role") != "admin" or not result.get("token"):
            raise CandidateProvisioningError("credential did not produce an administrator session")
        self.token = result["token"]


def all_knowledge(client: ApiClient) -> list[dict]:
    items: list[dict] = []
    page = 1
    while True:
        _, response = client.request("GET", f"/api/v1/knowledge/?page={page}")
        items.extend(response.get("items", []))
        if len(items) >= int(response.get("total", len(items))):
            return items
        page += 1


def managed_collection(client: ApiClient, definition: dict) -> dict:
    matches = [item for item in all_knowledge(client) if item.get("name") == definition["name"]]
    marker = f"[nettap-managed:{definition['key']}]"
    if len(matches) != 1 or marker not in (matches[0].get("description") or ""):
        raise CandidateProvisioningError(
            f"required managed collection is missing or ambiguous: {definition['name']}"
        )
    return matches[0]


def managed_skill(client: ApiClient, definition: dict) -> dict:
    skill_id = urllib.parse.quote(definition["id"], safe="")
    status, skill = client.request("GET", f"/api/v1/skills/id/{skill_id}", allow=(404,))
    tags = ((skill or {}).get("meta") or {}).get("tags") or []
    if status == 404 or "nettap-managed" not in tags:
        raise CandidateProvisioningError(f"required managed Skill is missing: {definition['id']}")
    return skill


def profile_payload(
    product_assistant: dict,
    runtime_model: str,
    release: str,
    suffix: str,
    knowledge: dict[str, dict],
    skills: dict[str, dict],
    existing: dict | None,
) -> dict:
    profile_id = f"{product_assistant['id']}-{suffix}"
    prompt = "\n\n".join(
        (ROOT / path).read_text(encoding="utf-8").strip()
        for path in product_assistant["system_prompt_files"]
    )
    current = existing or {}
    current_meta = current.get("meta") or {}
    meta = {
        "description": f"Evaluation-only Qwen3.5 9B candidate. {product_assistant['description']}",
        "suggestion_prompts": product_assistant["suggestion_prompts"],
        "tags": [{"name": tag} for tag in [*product_assistant["tags"], "Candidate", "Qwen3.5 9B"]],
        "knowledge": [
            {"id": knowledge[key]["id"], "name": knowledge[key]["name"]}
            for key in product_assistant["knowledge_keys"]
        ],
        "skillIds": [skills[key]["id"] for key in product_assistant.get("skill_keys", [])],
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
        "nettap_candidate": {
            "schema_version": 1,
            "release_version": release,
            "production_default": False,
            "baseline_profile_id": product_assistant["id"],
        },
    }
    if current_meta.get("profile_image_url"):
        meta["profile_image_url"] = current_meta["profile_image_url"]
    return {
        "id": profile_id,
        "base_model_id": runtime_model,
        "name": f"{product_assistant['name']} [Qwen3.5 Candidate]",
        "meta": meta,
        "params": {"system": prompt, "function_calling": "legacy"},
        "access_grants": current.get("access_grants") or [],
        "is_active": True,
    }


def reconcile_profile(client: ApiClient, payload: dict) -> str:
    query = urllib.parse.urlencode({"id": payload["id"]})
    status, existing = client.request("GET", f"/api/v1/models/model?{query}", allow=(404,))
    if status == 404:
        existing = None
    if existing and not ((existing.get("meta") or {}).get("nettap_candidate")):
        raise CandidateProvisioningError(
            f"refusing to overwrite unmanaged Workspace Model {payload['id']}"
        )
    if existing:
        _, result = client.request("POST", "/api/v1/models/model/update", payload)
        action = "updated"
    else:
        _, result = client.request("POST", "/api/v1/models/create", payload)
        action = "created"
    if result.get("base_model_id") != payload["base_model_id"]:
        raise CandidateProvisioningError(
            f"candidate profile {payload['id']} did not retain the candidate runtime"
        )
    return action


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--candidate-manifest", type=Path, required=True)
    parser.add_argument("--password-stdin", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.password_stdin:
        raise CandidateProvisioningError("administrator password must be supplied through stdin")
    password = sys.stdin.readline().rstrip("\n")
    if not password:
        raise CandidateProvisioningError("administrator password is empty")
    candidate = json.loads(args.candidate_manifest.read_text(encoding="utf-8"))
    product = json.loads(PRODUCT_MANIFEST.read_text(encoding="utf-8"))
    if candidate.get("schema_version") != 1 or candidate.get("status") != "evaluation-only":
        raise CandidateProvisioningError("invalid or non-evaluation candidate manifest")

    client = ApiClient(args.url)
    client.signin(args.email, password)
    del password

    collection_definitions = {item["key"]: item for item in product["knowledge_collections"]}
    skill_definitions = {item["key"]: item for item in product.get("skills", [])}
    needed_collections = {
        key for assistant in product["assistants"] for key in assistant["knowledge_keys"]
    }
    needed_skills = {key for assistant in product["assistants"] for key in assistant.get("skill_keys", [])}
    knowledge = {
        key: managed_collection(client, collection_definitions[key]) for key in needed_collections
    }
    skills = {key: managed_skill(client, skill_definitions[key]) for key in needed_skills}

    results = []
    for assistant in product["assistants"]:
        profile_id = f"{assistant['id']}-{candidate['profile_suffix']}"
        query = urllib.parse.urlencode({"id": profile_id})
        status, existing = client.request("GET", f"/api/v1/models/model?{query}", allow=(404,))
        payload = profile_payload(
            assistant,
            candidate["runtime_model"],
            candidate["release_version"],
            candidate["profile_suffix"],
            knowledge,
            skills,
            None if status == 404 else existing,
        )
        results.append({"id": profile_id, "action": reconcile_profile(client, payload)})

    print(json.dumps({"candidate": candidate["runtime_model"], "profiles": results}, indent=2))
    print("Candidate profiles are active but were not made default or pinned.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CandidateProvisioningError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
