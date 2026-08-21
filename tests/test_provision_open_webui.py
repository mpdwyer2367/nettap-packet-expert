#!/usr/bin/env python3
"""API-contract test for idempotent Open WebUI assistant and knowledge provisioning."""

from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
import urllib.parse


ROOT = Path(__file__).resolve().parents[1]
PROVISIONER = ROOT / "provisioning/provision_open_webui.py"


class OpenWebUIState:
    def __init__(self):
        self.knowledge = {}
        self.files = {}
        self.models = {}
        self.skills = {}
        self.uploads = 0
        self.rag_marker = "NETTAP-RAG-OFFLINE-PROBE-0.4.0-RC1"
        self.config = {
            "DEFAULT_MODELS": "",
            "DEFAULT_PINNED_MODELS": "",
            "MODEL_ORDER_LIST": [],
            "DEFAULT_MODEL_METADATA": {"preserved": True},
            "DEFAULT_MODEL_PARAMS": {"temperature": 0.2},
        }


class Handler(BaseHTTPRequestHandler):
    state = OpenWebUIState()

    def log_message(self, _format, *_args):
        pass

    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/health":
            return self.send_json(200, {"status": True})
        if path == "/api/v1/knowledge/":
            items = list(self.state.knowledge.values())
            return self.send_json(200, {"items": items, "total": len(items)})
        if path.startswith("/api/v1/knowledge/") and path.endswith("/files"):
            knowledge_id = path.split("/")[4]
            items = [item for item in self.state.files.values() if item["knowledge_id"] == knowledge_id]
            return self.send_json(200, {"items": items, "total": len(items)})
        if path.startswith("/api/v1/files/") and path.endswith("/process/status"):
            return self.send_json(200, {"status": "completed"})
        if path == "/api/v1/models/model":
            model_id = urllib.parse.parse_qs(parsed.query).get("id", [""])[0]
            if model_id not in self.state.models:
                return self.send_json(404, {"detail": "not found"})
            return self.send_json(200, self.state.models[model_id])
        if path == "/api/v1/skills/":
            return self.send_json(200, list(self.state.skills.values()))
        if path.startswith("/api/v1/skills/id/"):
            skill_id = urllib.parse.unquote(path.removeprefix("/api/v1/skills/id/"))
            if skill_id not in self.state.skills:
                return self.send_json(404, {"detail": "not found"})
            return self.send_json(200, self.state.skills[skill_id])
        if path == "/api/v1/retrieval/embedding":
            return self.send_json(200, {
                "RAG_EMBEDDING_ENGINE": "",
                "RAG_EMBEDDING_MODEL": "/app/backend/data/nettap-models/all-MiniLM-L6-v2/1110a243fdf4706b3f48f1d95db1a4f5529b4d41",
            })
        if path == "/api/v1/configs/models":
            return self.send_json(200, self.state.config)
        return self.send_json(404, {"detail": path})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/v1/auths/signin":
            payload = self.read_json()
            if payload != {"email": "admin@nettaptech.com", "password": "Test-password-123!"}:
                return self.send_json(401, {"detail": "bad credentials"})
            return self.send_json(200, {"token": "test-token", "role": "admin"})
        if path == "/api/v1/knowledge/create":
            payload = self.read_json()
            knowledge_id = f"knowledge-{len(self.state.knowledge) + 1}"
            payload["id"] = knowledge_id
            self.state.knowledge[knowledge_id] = payload
            return self.send_json(200, payload)
        if path.startswith("/api/v1/knowledge/") and path.endswith("/update"):
            knowledge_id = path.split("/")[4]
            payload = self.read_json()
            payload["id"] = knowledge_id
            self.state.knowledge[knowledge_id] = payload
            return self.send_json(200, payload)
        if path.startswith("/api/v1/knowledge/") and path.endswith("/file/remove"):
            file_id = self.read_json()["file_id"]
            self.state.files.pop(file_id, None)
            return self.send_json(200, True)
        if path == "/api/v1/files/":
            length = int(self.headers["Content-Length"])
            raw = self.rfile.read(length)
            envelope = BytesParser(policy=default).parsebytes(
                f"Content-Type: {self.headers['Content-Type']}\r\nMIME-Version: 1.0\r\n\r\n".encode() + raw
            )
            metadata = None
            filename = None
            for part in envelope.iter_parts():
                if part.get_param("name", header="content-disposition") == "metadata":
                    metadata = json.loads(part.get_content())
                if part.get_param("name", header="content-disposition") == "file":
                    filename = part.get_filename()
            if not metadata or not filename:
                return self.send_json(400, {"detail": "invalid multipart form"})
            self.state.uploads += 1
            file_id = f"file-{self.state.uploads}"
            self.state.files[file_id] = {
                "id": file_id,
                "knowledge_id": metadata["knowledge_id"],
                "filename": filename,
                "hash": metadata["file_hash"],
                "meta": metadata,
            }
            return self.send_json(200, {"id": file_id})
        if path == "/api/v1/retrieval/query/collection":
            payload = self.read_json()
            if not payload.get("collection_names"):
                return self.send_json(400, {"detail": "collection required"})
            return self.send_json(200, {"documents": [[self.state.rag_marker]]})
        if path in {"/api/v1/models/create", "/api/v1/models/model/update"}:
            payload = self.read_json()
            self.state.models[payload["id"]] = payload
            return self.send_json(200, payload)
        if path == "/api/v1/skills/create":
            payload = self.read_json()
            self.state.skills[payload["id"]] = payload
            return self.send_json(200, payload)
        if path.startswith("/api/v1/skills/id/") and path.endswith("/update"):
            skill_id = urllib.parse.unquote(path.removeprefix("/api/v1/skills/id/").removesuffix("/update"))
            payload = self.read_json()
            payload["id"] = skill_id
            self.state.skills[skill_id] = payload
            return self.send_json(200, payload)
        if path == "/api/v1/configs/models":
            payload = self.read_json()
            self.state.config = payload
            return self.send_json(200, payload)
        return self.send_json(404, {"detail": path})


class ProvisioningTest(unittest.TestCase):
    def setUp(self):
        Handler.state = OpenWebUIState()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.tempdir = tempfile.TemporaryDirectory()
        self.state_path = Path(self.tempdir.name) / "provisioning-state.json"
        self.env = os.environ.copy()
        self.env.update({
            "OPEN_WEBUI_URL": f"http://127.0.0.1:{self.server.server_port}",
            "WEBUI_ADMIN_EMAIL": "admin@nettaptech.com",
            "RELEASE_VERSION": "0.4.0-rc.1",
            "NETTAP_AI_MODEL": "nettap-ai:0.4.0-rc.1",
            "NETTAP_PROVISIONING_MANIFEST": str(ROOT / "provisioning/open-webui.json"),
            "NETTAP_PROVISIONING_CHECKSUMS": str(ROOT / "provisioning/knowledge-sources.sha256"),
            "NETTAP_PROVISIONING_SOURCE_ROOT": str(ROOT),
            "NETTAP_PROVISIONING_STATE": str(self.state_path),
        })

    def tearDown(self):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()
        self.tempdir.cleanup()

    def run_provisioner(self, *args, check=True):
        return subprocess.run(
            ["python3", str(PROVISIONER), *args],
            input="Test-password-123!\n",
            text=True,
            capture_output=True,
            check=check,
            env=self.env,
        )

    def test_provisions_offline_rag_and_profiles_idempotently(self):
        first = self.run_provisioner()
        self.assertIn("Offline RAG verification: PASS", first.stdout)
        self.assertEqual(len(Handler.state.knowledge), 3)
        self.assertEqual(len(Handler.state.files), 5)
        self.assertEqual(Handler.state.uploads, 5)
        self.assertEqual(set(Handler.state.models), {
            "nettap-network-visibility", "nettap-packet-expert"
        })
        self.assertEqual(set(Handler.state.skills), {
            "nettap-network-visibility", "nettap-packet-expert"
        })
        for skill in Handler.state.skills.values():
            self.assertTrue(skill["content"].startswith("# NetTAP "))
            self.assertNotIn("\nname: nettap-", skill["content"])
        for model in Handler.state.models.values():
            self.assertEqual(model["base_model_id"], "nettap-ai:0.4.0-rc.1")
            self.assertEqual(model["params"]["function_calling"], "legacy")
            self.assertEqual(len(model["meta"]["knowledge"]), 2)
            self.assertEqual(len(model["meta"]["skillIds"]), 1)
        self.assertEqual(
            Handler.state.models["nettap-network-visibility"]["meta"]["skillIds"],
            ["nettap-network-visibility"],
        )
        self.assertEqual(
            Handler.state.models["nettap-packet-expert"]["meta"]["skillIds"],
            ["nettap-packet-expert"],
        )
        self.assertEqual(
            Handler.state.config["DEFAULT_PINNED_MODELS"],
            "nettap-network-visibility,nettap-packet-expert",
        )
        self.assertEqual(Handler.state.config["DEFAULT_MODEL_METADATA"], {"preserved": True})

        next(iter(Handler.state.knowledge.values()))["access_grants"] = [
            {"group_id": "network-team", "permission": "read"}
        ]
        Handler.state.models["nettap-network-visibility"]["access_grants"] = [
            {"group_id": "network-team", "permission": "read"}
        ]
        Handler.state.skills["nettap-network-visibility"]["access_grants"] = [
            {"group_id": "network-team", "permission": "read"}
        ]
        second = self.run_provisioner()
        self.assertIn("Offline RAG verification: PASS", second.stdout)
        self.assertEqual(Handler.state.uploads, 5)
        self.assertEqual(len(Handler.state.knowledge), 3)
        self.assertEqual(len(Handler.state.models), 2)
        self.assertEqual(len(Handler.state.skills), 2)
        self.assertEqual(
            next(iter(Handler.state.knowledge.values()))["access_grants"],
            [{"group_id": "network-team", "permission": "read"}],
        )
        self.assertEqual(
            Handler.state.models["nettap-network-visibility"]["access_grants"],
            [{"group_id": "network-team", "permission": "read"}],
        )
        self.assertEqual(
            Handler.state.skills["nettap-network-visibility"]["access_grants"],
            [{"group_id": "network-team", "permission": "read"}],
        )
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        self.assertEqual(state["release_version"], "0.4.0-rc.1")
        installed = self.run_provisioner("--installed-fingerprint").stdout.strip()
        self.assertEqual(installed, state["fingerprint"])
        self.assertEqual(state["offline_rag"]["result"], "PASS")
        self.assertEqual(set(state["skills"]), {"network_visibility", "packet_expert"})
        self.assertEqual(
            {item["id"]: item["skill_ids"] for item in state["assistants"]},
            {
                "nettap-network-visibility": ["nettap-network-visibility"],
                "nettap-packet-expert": ["nettap-packet-expert"],
            },
        )

    def test_fingerprint_is_deterministic_without_api_access(self):
        one = self.run_provisioner("--fingerprint").stdout.strip()
        two = self.run_provisioner("--fingerprint").stdout.strip()
        self.assertEqual(one, two)
        self.assertRegex(one, r"^[0-9a-f]{64}$")

    def test_verifies_administrator_credentials_through_api(self):
        result = self.run_provisioner("--verify-admin")
        self.assertIn("Open WebUI administrator API verification: PASS", result.stdout)

    def test_refuses_unmanaged_collection_name_collision(self):
        Handler.state.knowledge["operator-1"] = {
            "id": "operator-1",
            "name": "NetTAP Network Intelligence Shared (Managed)",
            "description": "operator-owned content",
        }
        result = self.run_provisioner(check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing to overwrite unmanaged knowledge collection", result.stderr)
        self.assertFalse(self.state_path.exists())
        self.assertEqual(Handler.state.uploads, 0)

    def test_refuses_unmanaged_skill_identity_collision(self):
        Handler.state.skills["nettap-network-visibility"] = {
            "id": "nettap-network-visibility",
            "name": "Operator-owned skill",
            "description": "not managed by NetTAP",
            "content": "operator instructions",
            "meta": {"tags": []},
            "is_active": True,
            "access_grants": [],
        }
        result = self.run_provisioner(check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing to overwrite unmanaged Open WebUI Skill", result.stderr)
        self.assertFalse(self.state_path.exists())
        self.assertEqual(Handler.state.models, {})

    def test_adopts_recognized_legacy_packet_expert_profile(self):
        Handler.state.models["nettap-packet-expert"] = {
            "id": "nettap-packet-expert",
            "name": "NetTAP Packet Expert",
            "base_model_id": "nettap-ai:0.3.0-rc.4",
            "meta": {"description": "legacy profile"},
            "params": {"system": "legacy prompt"},
            "access_grants": [{"group_id": "packet-team", "permission": "read"}],
            "is_active": True,
        }

        result = self.run_provisioner()

        self.assertIn(
            "Workspace Model updated: NetTAP Network Intelligence — Packet Expert",
            result.stdout,
        )
        migrated = Handler.state.models["nettap-packet-expert"]
        self.assertEqual(migrated["name"], "NetTAP Network Intelligence — Packet Expert")
        self.assertEqual(migrated["base_model_id"], "nettap-ai:0.4.0-rc.1")
        self.assertEqual(
            migrated["access_grants"],
            [{"group_id": "packet-team", "permission": "read"}],
        )
        self.assertEqual(migrated["meta"]["nettap_managed"]["release_version"], "0.4.0-rc.1")

    def test_refuses_unrecognized_workspace_model_identity_collision(self):
        Handler.state.models["nettap-packet-expert"] = {
            "id": "nettap-packet-expert",
            "name": "Operator Packet Analysis",
            "base_model_id": "operator-model:latest",
            "meta": {},
            "params": {"system": "operator prompt"},
            "access_grants": [],
            "is_active": True,
        }

        result = self.run_provisioner(check=False)

        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing to overwrite unmanaged Workspace Model nettap-packet-expert", result.stderr)
        self.assertIn("name='Operator Packet Analysis'", result.stderr)
        self.assertIn("base_model_id='operator-model:latest'", result.stderr)
        self.assertEqual(
            Handler.state.models["nettap-packet-expert"]["params"]["system"],
            "operator prompt",
        )
        self.assertFalse(self.state_path.exists())

    def test_fails_closed_when_offline_retrieval_marker_is_missing(self):
        Handler.state.rag_marker = "unexpected result"
        result = self.run_provisioner(check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("did not return the managed verification marker", result.stderr)
        self.assertFalse(self.state_path.exists())
        self.assertEqual(Handler.state.models, {})

    def test_fails_closed_when_pinned_source_identity_changes(self):
        checksum_path = Path(self.tempdir.name) / "knowledge-sources.sha256"
        pinned_sources = (ROOT / "provisioning/knowledge-sources.sha256").read_text(
            encoding="utf-8"
        )
        first_hash = pinned_sources.split(None, 1)[0]
        checksum_path.write_text(
            pinned_sources.replace(first_hash, "0" * 64, 1),
            encoding="utf-8",
        )
        self.env["NETTAP_PROVISIONING_CHECKSUMS"] = str(checksum_path)
        result = self.run_provisioner("--fingerprint", check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("pinned source identity mismatch", result.stderr)


if __name__ == "__main__":
    unittest.main()
