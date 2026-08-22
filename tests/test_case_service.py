#!/usr/bin/env python3
"""Functional and security-boundary tests for the local evidence service."""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import struct
import tempfile
from threading import Thread
import unittest
import urllib.error
import urllib.request

from case_service.database import NotFoundError, Repository, compact_json
from case_service.http_api import handler_factory
from case_service.parsers import ParseError, parse_evidence
from case_service.service import EvidenceService, ValidationError, sanitize_filename
from http.server import ThreadingHTTPServer


ROOT = Path(__file__).resolve().parents[1]
TOKEN = "test-only-token-00000000000000000000000000000000"


class CaseServiceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=ROOT)
        self.root = Path(self.temporary.name)
        self.repository = Repository(self.root / "case.db", self.root / "files")
        self.service = EvidenceService(self.repository, max_records=1000)

    def tearDown(self):
        self.temporary.cleanup()

    def make_case(self):
        return self.service.create_case(
            {
                "title": "Authorized telemetry investigation",
                "objective": "Understand recurring outbound flows",
                "environment": "Synthetic lab",
            }
        )

    def test_normalized_flow_ingestion_analysis_and_llm_context(self):
        case = self.make_case()
        start = datetime(2026, 8, 5, 12, 0, tzinfo=timezone.utc)
        records = []
        for index in range(8):
            records.append(
                {
                    "timestamp": (start + timedelta(seconds=60 * index)).isoformat(),
                    "src_ip": "10.0.0.10",
                    "dst_ip": "198.51.100.25",
                    "dst_port": 443,
                    "protocol": "tcp",
                    "bytes": 320,
                    "password": "must-not-reach-context",
                }
            )
        payload = "\n".join(json.dumps(item) for item in records).encode()
        evidence = self.service.ingest(
            case["id"],
            "ipfix",
            "flows.jsonl",
            payload,
            complete_metadata("edge-exporter-1"),
            hashlib.sha256(payload).hexdigest(),
        )
        self.assertEqual(evidence["record_count"], 8)
        result = self.service.analyze(case["id"])
        hypotheses = [item for item in result["findings"] if item["classification"] == "hypothesis"]
        self.assertEqual(len(hypotheses), 1)
        self.assertIn("not confirmed C2", hypotheses[0]["statement"])
        observation_citations = [
            item
            for item in hypotheses[0]["citations"]
            if item["type"] == "normalized_observation"
        ]
        self.assertEqual(len(observation_citations), 8)
        resolved = self.repository.get_observation(
            case["id"], observation_citations[0]["observation_id"]
        )
        self.assertEqual(resolved["evidence_id"], evidence["id"])
        self.assertEqual(resolved["sequence_number"], 1)
        self.assertEqual(len(result["latest_analysis"]["output_sha256"]), 64)
        artifact = self.repository.get_analysis(
            case["id"], result["latest_analysis"]["id"]
        )
        self.assertEqual(
            hashlib.sha256(compact_json(artifact["artifact"]).encode()).hexdigest(),
            artifact["output_sha256"],
        )

        context = self.service.context(case["id"])
        rendered = json.dumps(context)
        self.assertFalse(context["live_telemetry_connected"])
        self.assertFalse(context["raw_evidence_included"])
        self.assertNotIn("must-not-reach-context", rendered)
        self.assertIn("sensitive record field(s) were redacted", rendered)
        self.assertIn(evidence["id"], rendered)
        self.assertIn("analysis_artifact", rendered)
        self.assertIn("Resolvable citations", self.service.markdown_report(case["id"]))
        pdf = self.service.pdf_report(case["id"])
        self.assertTrue(pdf.startswith(b"%PDF-1.4"))
        self.assertTrue(pdf.rstrip().endswith(b"%%EOF"))

    def test_pcap_parser_extracts_metadata_without_payload(self):
        capture = build_pcap()
        parsed = parse_evidence("pcap", capture, complete_metadata("capture-host"), 100)
        self.assertEqual(len(parsed.observations), 1)
        packet = parsed.observations[0]
        self.assertEqual(packet["src_ip"], "192.0.2.10")
        self.assertEqual(packet["dst_ip"], "198.51.100.20")
        self.assertEqual(packet["src_port"], 49152)
        self.assertEqual(packet["dst_port"], 443)
        self.assertEqual(packet["protocol"], "TCP")
        self.assertNotIn("payload", packet)
        self.assertEqual(parsed.metadata["pcap_linktype"], 1)

    def test_pcapng_is_rejected_with_actionable_normalization_guidance(self):
        with self.assertRaisesRegex(ParseError, "normalize it with TShark"):
            parse_evidence(
                "pcap", b"\x0a\x0d\x0d\x0a" + b"\0" * 32, complete_metadata("host"), 100
            )

    def test_hash_mismatch_fails_before_persistence(self):
        case = self.make_case()
        with self.assertRaisesRegex(ValidationError, "does not match"):
            self.service.ingest(
                case["id"], "jsonl", "sample.jsonl", b'{"event":"test"}\n', {}, "0" * 64
            )
        self.assertEqual(self.repository.evidence_for_case(case["id"]), [])

    def test_unreviewed_metadata_cannot_enter_llm_context(self):
        case = self.make_case()
        payload = b'{"src_ip":"192.0.2.1","dst_ip":"198.51.100.2"}\n'
        metadata = complete_metadata("exporter")
        metadata["raw_payload"] = "must-not-enter-context"
        metadata["authorization"] = "Bearer must-not-enter-context"
        self.service.ingest(case["id"], "jsonl", "records.jsonl", payload, metadata, None)
        self.service.analyze(case["id"])
        rendered = json.dumps(self.service.context(case["id"]))
        self.assertNotIn("must-not-enter-context", rendered)
        self.assertNotIn("raw_payload", rendered)
        self.assertIn("unrecognized or non-scalar metadata", rendered)
        self.assertIn("sensitive metadata field", rendered)

    def test_deep_json_is_rejected_as_parser_input(self):
        payload = ("[" * 40 + "0" + "]" * 40).encode()
        with self.assertRaisesRegex(ParseError, "nesting depth"):
            parse_evidence("json", payload, complete_metadata("host"), 100)

    def test_filename_cannot_escape_evidence_directory(self):
        self.assertEqual(sanitize_filename("../../private/customer.pcap"), "customer.pcap")
        self.assertEqual(sanitize_filename("..\\..\\bad|name.pcap"), "bad_name.pcap")

    def test_citation_resolution_is_scoped_to_case(self):
        first = self.make_case()
        second = self.make_case()
        payload = b'{"src_ip":"192.0.2.1","dst_ip":"198.51.100.2"}\n'
        self.service.ingest(first["id"], "jsonl", "records.jsonl", payload, {}, None)
        observation = self.repository.observations_for_case(first["id"])[0]
        with self.assertRaisesRegex(NotFoundError, "observation not found in case"):
            self.repository.get_observation(second["id"], observation["observation_id"])
        analyzed = self.service.analyze(first["id"])
        with self.assertRaisesRegex(NotFoundError, "analysis not found in case"):
            self.repository.get_analysis(second["id"], analyzed["latest_analysis"]["id"])

    def test_schema_v1_database_is_migrated_without_data_loss(self):
        database = self.root / "legacy.db"
        with sqlite3.connect(database) as connection:
            connection.executescript(
                """
                CREATE TABLE schema_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                INSERT INTO schema_metadata VALUES('schema_version','1');
                CREATE TABLE findings (
                    id TEXT PRIMARY KEY, case_id TEXT NOT NULL, category TEXT NOT NULL,
                    title TEXT NOT NULL, statement TEXT NOT NULL, classification TEXT NOT NULL,
                    confidence TEXT NOT NULL, evidence_ids_json TEXT NOT NULL,
                    validation_steps_json TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE analyses (
                    id TEXT PRIMARY KEY, case_id TEXT NOT NULL, created_at TEXT NOT NULL,
                    engine_version TEXT NOT NULL, summary_json TEXT NOT NULL
                );
                """
            )
        migrated = Repository(database, self.root / "legacy-files")
        with migrated.connection() as connection:
            version = connection.execute(
                "SELECT value FROM schema_metadata WHERE key='schema_version'"
            ).fetchone()["value"]
            finding_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(findings)")
            }
            analysis_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(analyses)")
            }
        self.assertEqual(version, "2")
        self.assertIn("citations_json", finding_columns)
        self.assertIn("output_sha256", analysis_columns)
        self.assertIn("artifact_json", analysis_columns)

    def test_api_requires_bearer_token_and_supports_end_to_end_case(self):
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0), handler_factory(self.service, self.repository, TOKEN, 1024 * 1024)
        )
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with self.assertRaises(urllib.error.HTTPError) as unauthorized:
                urllib.request.urlopen(f"{base}/v1/cases", timeout=5)
            self.assertEqual(unauthorized.exception.code, 401)

            request = urllib.request.Request(
                f"{base}/v1/cases",
                data=json.dumps({"title": "API case", "objective": "Test", "environment": "Lab"}).encode(),
                headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                created = json.load(response)
            metadata = base64.urlsafe_b64encode(
                json.dumps(complete_metadata("api-exporter")).encode()
            ).decode().rstrip("=")
            data = b'{"src_ip":"10.1.1.1","dst_ip":"10.2.2.2","protocol":"udp"}\n'
            upload = urllib.request.Request(
                f"{base}/v1/cases/{created['id']}/evidence?source_type=jsonl&filename=sample.jsonl",
                data=data,
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/octet-stream",
                    "X-NetTAP-Metadata": metadata,
                    "X-Content-SHA256": hashlib.sha256(data).hexdigest(),
                },
                method="POST",
            )
            with urllib.request.urlopen(upload, timeout=5) as response:
                imported = json.load(response)
            self.assertEqual(imported["record_count"], 1)

            analyze = urllib.request.Request(
                f"{base}/v1/cases/{created['id']}/analyze",
                data=b"",
                headers={"Authorization": f"Bearer {TOKEN}"},
                method="POST",
            )
            with urllib.request.urlopen(analyze, timeout=5) as response:
                analyzed = json.load(response)
            self.assertEqual(analyzed["latest_analysis"]["summary"]["observation_count"], 1)
            observation = self.repository.observations_for_case(created["id"])[0]
            resolve = urllib.request.Request(
                f"{base}/v1/cases/{created['id']}/observations/{observation['observation_id']}",
                headers={"Authorization": f"Bearer {TOKEN}"},
            )
            with urllib.request.urlopen(resolve, timeout=5) as response:
                resolved = json.load(response)
            self.assertEqual(resolved["observation_id"], observation["observation_id"])
            self.assertEqual(resolved["sequence_number"], 1)
            artifact_request = urllib.request.Request(
                f"{base}/v1/cases/{created['id']}/analyses/{analyzed['latest_analysis']['id']}",
                headers={"Authorization": f"Bearer {TOKEN}"},
            )
            with urllib.request.urlopen(artifact_request, timeout=5) as response:
                artifact = json.load(response)
            self.assertEqual(artifact["output_sha256"], analyzed["latest_analysis"]["output_sha256"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


def complete_metadata(exporter: str) -> dict[str, object]:
    return {
        "source_timezone": "UTC",
        "clock_sync_status": "synchronized",
        "observation_point": "synthetic-test",
        "schema_version": "test-v1",
        "chain_of_custody": "unit-test",
        "exporter_identity": exporter,
        "sampling_rate": 1,
        "ipfix_template_status": "valid",
        "capture_drops": 0,
        "truncation": False,
    }


def build_pcap() -> bytes:
    ethernet = bytes.fromhex("00112233445566778899aabb0800")
    source = bytes([192, 0, 2, 10])
    destination = bytes([198, 51, 100, 20])
    total_length = 40
    ipv4 = struct.pack(
        "!BBHHHBBH4s4s",
        0x45,
        0,
        total_length,
        1,
        0,
        64,
        6,
        0,
        source,
        destination,
    )
    tcp = struct.pack("!HHIIBBHHH", 49152, 443, 1, 0, 5 << 4, 0x02, 65535, 0, 0)
    packet = ethernet + ipv4 + tcp
    global_header = struct.pack("<IHHIIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1)
    record_header = struct.pack("<IIII", 1_786_000_000, 250_000, len(packet), len(packet))
    return global_header + record_header + packet


if __name__ == "__main__":
    unittest.main()
