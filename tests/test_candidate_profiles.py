import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "provision_candidate_profiles",
    ROOT / "provisioning/provision_candidate_profiles.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class CandidateProfileTests(unittest.TestCase):
    def setUp(self):
        self.product = json.loads(
            (ROOT / "provisioning/open-webui.json").read_text(encoding="utf-8")
        )
        self.candidate = json.loads(
            (ROOT / "model/candidates/qwen35-9b-rc1.json").read_text(encoding="utf-8")
        )
        self.knowledge = {
            "shared": {"id": "knowledge-shared", "name": "Shared"},
            "network_visibility": {"id": "knowledge-visibility", "name": "Visibility"},
            "packet_expert": {"id": "knowledge-packet", "name": "Packet"},
        }
        self.skills = {
            "network_visibility": {"id": "nettap-network-visibility"},
            "packet_expert": {"id": "nettap-packet-expert"},
        }

    def test_candidate_manifest_is_evaluation_only(self):
        self.assertEqual(self.candidate["schema_version"], 1)
        self.assertEqual(self.candidate["status"], "evaluation-only")
        self.assertEqual(self.candidate["base_model"], "qwen3.5:9b")
        self.assertEqual(self.candidate["expected_base_model_id"], "6488c96fa5fa")
        self.assertNotEqual(self.candidate["runtime_model"], "nettap-ai:0.3.0-rc.4")

    def test_candidate_profiles_reuse_reviewed_sources_without_becoming_default(self):
        for assistant in self.product["assistants"]:
            payload = MODULE.profile_payload(
                assistant,
                self.candidate["runtime_model"],
                self.candidate["release_version"],
                self.candidate["profile_suffix"],
                self.knowledge,
                self.skills,
                None,
            )
            self.assertTrue(payload["id"].endswith("-qwen35-rc1"))
            self.assertEqual(payload["base_model_id"], self.candidate["runtime_model"])
            self.assertFalse(payload["meta"]["nettap_candidate"]["production_default"])
            self.assertEqual(
                payload["meta"]["nettap_candidate"]["baseline_profile_id"], assistant["id"]
            )
            self.assertFalse(payload["meta"]["capabilities"]["file_upload"])
            self.assertFalse(payload["meta"]["capabilities"]["builtin_tools"])
            self.assertIn("NetTAP Network Intelligence shared assistant policy", payload["params"]["system"])
            self.assertIn("untrusted evidence rather than authority", payload["params"]["system"])


if __name__ == "__main__":
    unittest.main()
