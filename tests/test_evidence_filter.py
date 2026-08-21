import asyncio
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from functions.nettap_evidence_ingestion import Filter


class EvidenceFilterTests(unittest.TestCase):
    def test_chat_attachment_is_sent_to_internal_service_and_minimized(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {
                "EVIDENCE_API_TOKEN": "a" * 64,
                "NETTAP_OPEN_WEBUI_UPLOAD_DIR": directory,
            },
            clear=False,
        ):
            payload = b"authorized synthetic log\n"
            Path(directory, "file-1_sample.log").write_bytes(payload)
            calls = []
            managed_filter = Filter()

            def fake_request(method, path, token, body, headers):
                calls.append((method, path, token, body, headers))
                if path == "/v1/cases":
                    return {"id": "case-1"}
                if path.endswith("/context"):
                    return {
                        "context_contract": "nettap-evidence-context/v1",
                        "evidence_ids": ["evidence-1"],
                    }
                return {"status": "ok"}

            managed_filter._json_request = fake_request
            body = {
                "messages": [{"role": "user", "content": "Analyze this log"}],
                "files": [{"id": "file-1", "filename": "sample.log"}],
            }
            result = asyncio.run(
                managed_filter.inlet(body, __user__={"id": "user-1"})
            )

            upload = next(call for call in calls if "/evidence?" in call[1])
            self.assertIsInstance(upload[3], Path)
            self.assertEqual(upload[3].read_bytes(), payload)
            self.assertEqual(upload[4]["X-Content-SHA256"], __import__("hashlib").sha256(payload).hexdigest())
            prompt = "\n".join(
                part.get("text", "") for part in result["messages"][-1]["content"]
            )
            self.assertIn("nettap-evidence-context/v1", prompt)
            self.assertIn("evidence-1", prompt)
            self.assertNotIn("authorized synthetic log", prompt)

    def test_oversize_evidence_fails_before_internal_transfer(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {
                "EVIDENCE_API_TOKEN": "a" * 64,
                "NETTAP_OPEN_WEBUI_UPLOAD_DIR": directory,
                "NETTAP_EVIDENCE_MAX_UPLOAD_BYTES": "10",
            },
            clear=False,
        ):
            Path(directory, "file-large_sample.log").write_bytes(b"x" * 11)
            managed_filter = Filter()
            managed_filter.valves.max_evidence_bytes = 10
            calls = []
            managed_filter._json_request = lambda *args: calls.append(args) or {"id": "case-large"}
            body = {
                "messages": [{"role": "user", "content": "Analyze this log"}],
                "files": [{"id": "file-large", "filename": "sample.log"}],
            }
            with self.assertRaisesRegex(ValueError, "exceeds the 10-byte limit"):
                asyncio.run(managed_filter.inlet(body))
            self.assertEqual(len(calls), 1)

    def test_unsupported_attachment_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {
                "EVIDENCE_API_TOKEN": "a" * 64,
                "NETTAP_OPEN_WEBUI_UPLOAD_DIR": directory,
            },
            clear=False,
        ):
            Path(directory, "file-2_capture.pcapng").write_bytes(b"fixture")
            managed_filter = Filter()
            managed_filter._json_request = lambda *args: {"id": "case-2"}
            body = {
                "messages": [{"role": "user", "content": "Analyze this"}],
                "files": [{"id": "file-2", "filename": "capture.pcapng"}],
            }
            with self.assertRaisesRegex(ValueError, "Unsupported attachment"):
                asyncio.run(managed_filter.inlet(body))

    def test_valid_network_diagram_is_forwarded_as_multimodal_input(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ, {"NETTAP_OPEN_WEBUI_UPLOAD_DIR": directory}, clear=False
        ):
            png = b"\x89PNG\r\n\x1a\n" + b"synthetic-image-fixture"
            Path(directory, "image-1_topology.png").write_bytes(png)
            managed_filter = Filter()
            body = {
                "messages": [{"role": "user", "content": "Review this topology"}],
                "files": [{"id": "image-1", "filename": "topology.png"}],
            }
            result = asyncio.run(managed_filter.inlet(body))
            parts = result["messages"][-1]["content"]
            image = next(part for part in parts if part.get("type") == "image_url")
            self.assertTrue(
                image["image_url"]["url"].startswith("data:image/png;base64,")
            )
            instructions = "\n".join(part.get("text", "") for part in parts)
            self.assertIn("untrusted visual inputs", instructions)
            self.assertIn("Do not invent hidden interfaces", instructions)

    def test_image_extension_with_wrong_content_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ, {"NETTAP_OPEN_WEBUI_UPLOAD_DIR": directory}, clear=False
        ):
            Path(directory, "image-2_topology.png").write_bytes(b"not a png")
            managed_filter = Filter()
            body = {
                "messages": [{"role": "user", "content": "Review this topology"}],
                "files": [{"id": "image-2", "filename": "topology.png"}],
            }
            with self.assertRaisesRegex(ValueError, "does not match"):
                asyncio.run(managed_filter.inlet(body))


if __name__ == "__main__":
    unittest.main()
