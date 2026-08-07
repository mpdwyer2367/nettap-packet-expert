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
                    return {"schema": "nettap-evidence-context/v1", "evidence_ids": ["evidence-1"]}
                return {"status": "ok"}

            managed_filter._json_request = fake_request
            body = {
                "messages": [{"role": "user", "content": "Analyze this log"}],
                "files": [{"id": "file-1", "filename": "sample.log"}],
            }
            result = asyncio.run(managed_filter.inlet(body, __user__={"id": "user-1"}))

            upload = next(call for call in calls if "/evidence?" in call[1])
            self.assertEqual(upload[3], payload)
            prompt = result["messages"][-1]["content"]
            self.assertIn("nettap-evidence-context/v1", prompt)
            self.assertIn("evidence-1", prompt)
            self.assertNotIn("authorized synthetic log", prompt)

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


if __name__ == "__main__":
    unittest.main()
