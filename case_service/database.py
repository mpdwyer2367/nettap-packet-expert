"""SQLite persistence for cases, evidence, observations, findings and audit events."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from typing import Any, Iterator
import uuid


SCHEMA_VERSION = 2


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


class NotFoundError(LookupError):
    pass


class ConflictError(RuntimeError):
    pass


class Repository:
    def __init__(self, database_path: Path, evidence_directory: Path):
        self.database_path = database_path
        self.evidence_directory = evidence_directory
        database_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        evidence_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(database_path.parent, 0o700)
        os.chmod(evidence_directory, 0o700)
        self._initialize()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self.connection() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS schema_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS cases (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    objective TEXT NOT NULL,
                    environment TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('open','closed')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS evidence (
                    id TEXT PRIMARY KEY,
                    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
                    source_type TEXT NOT NULL,
                    original_filename TEXT NOT NULL,
                    stored_filename TEXT NOT NULL UNIQUE,
                    sha256 TEXT NOT NULL,
                    byte_size INTEGER NOT NULL,
                    received_at TEXT NOT NULL,
                    parser_name TEXT NOT NULL,
                    parser_version TEXT NOT NULL,
                    record_count INTEGER NOT NULL,
                    metadata_json TEXT NOT NULL,
                    quality_warnings_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS observations (
                    id TEXT PRIMARY KEY,
                    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
                    evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
                    sequence_number INTEGER NOT NULL,
                    observed_at TEXT,
                    kind TEXT NOT NULL,
                    normalized_json TEXT NOT NULL,
                    UNIQUE(evidence_id, sequence_number)
                );
                CREATE INDEX IF NOT EXISTS observations_case_idx
                    ON observations(case_id, observed_at);
                CREATE TABLE IF NOT EXISTS findings (
                    id TEXT PRIMARY KEY,
                    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
                    category TEXT NOT NULL,
                    title TEXT NOT NULL,
                    statement TEXT NOT NULL,
                    classification TEXT NOT NULL,
                    confidence TEXT NOT NULL,
                    evidence_ids_json TEXT NOT NULL,
                    citations_json TEXT NOT NULL,
                    validation_steps_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS analyses (
                    id TEXT PRIMARY KEY,
                    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL,
                    engine_version TEXT NOT NULL,
                    summary_json TEXT NOT NULL,
                    output_sha256 TEXT NOT NULL,
                    artifact_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    action TEXT NOT NULL,
                    case_id TEXT,
                    evidence_id TEXT,
                    outcome TEXT NOT NULL,
                    details_json TEXT NOT NULL
                );
                """
            )
            row = connection.execute(
                "SELECT value FROM schema_metadata WHERE key = 'schema_version'"
            ).fetchone()
            if row:
                current_version = int(row["value"])
                if current_version == 1:
                    connection.execute(
                        "ALTER TABLE findings ADD COLUMN citations_json TEXT NOT NULL DEFAULT '[]'"
                    )
                    connection.execute(
                        "ALTER TABLE analyses ADD COLUMN output_sha256 TEXT NOT NULL DEFAULT ''"
                    )
                    connection.execute(
                        "ALTER TABLE analyses ADD COLUMN artifact_json TEXT NOT NULL DEFAULT '{}'"
                    )
                elif current_version != SCHEMA_VERSION:
                    raise RuntimeError("Unsupported evidence database schema version")
            connection.execute(
                "INSERT OR REPLACE INTO schema_metadata(key,value) VALUES('schema_version',?)",
                (str(SCHEMA_VERSION),),
            )
        if self.database_path.exists():
            os.chmod(self.database_path, 0o600)

    def create_case(self, title: str, objective: str, environment: str) -> dict[str, Any]:
        case_id = str(uuid.uuid4())
        now = utc_now()
        with self.connection() as connection:
            connection.execute(
                "INSERT INTO cases VALUES(?,?,?,?,?,?,?)",
                (case_id, title, objective, environment, "open", now, now),
            )
            self._audit(connection, "case.create", case_id, None, "success", {})
        return self.get_case(case_id)

    def list_cases(self) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = connection.execute(
                """
                SELECT c.*,
                       COUNT(DISTINCT e.id) AS evidence_count,
                       COUNT(DISTINCT a.id) AS analysis_count
                FROM cases c
                LEFT JOIN evidence e ON e.case_id = c.id
                LEFT JOIN analyses a ON a.case_id = c.id
                GROUP BY c.id ORDER BY c.updated_at DESC
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def get_case(self, case_id: str) -> dict[str, Any]:
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
            if not row:
                raise NotFoundError("case not found")
            result = dict(row)
            evidence = connection.execute(
                "SELECT * FROM evidence WHERE case_id = ? ORDER BY received_at", (case_id,)
            ).fetchall()
            result["evidence"] = [self._evidence_row(item) for item in evidence]
            analysis = connection.execute(
                "SELECT * FROM analyses WHERE case_id = ? ORDER BY created_at DESC LIMIT 1",
                (case_id,),
            ).fetchone()
            result["latest_analysis"] = self._analysis_row(analysis) if analysis else None
            findings = connection.execute(
                "SELECT * FROM findings WHERE case_id = ? ORDER BY created_at, id", (case_id,)
            ).fetchall()
            result["findings"] = [self._finding_row(item) for item in findings]
            return result

    def require_open_case(self, case_id: str) -> None:
        with self.connection() as connection:
            row = connection.execute("SELECT status FROM cases WHERE id = ?", (case_id,)).fetchone()
        if not row:
            raise NotFoundError("case not found")
        if row["status"] != "open":
            raise ConflictError("case is closed")

    def add_evidence(
        self,
        case_id: str,
        source_type: str,
        original_filename: str,
        content: bytes,
        digest: str,
        parser_name: str,
        parser_version: str,
        metadata: dict[str, Any],
        quality_warnings: list[str],
        observations: list[dict[str, Any]],
    ) -> dict[str, Any]:
        self.require_open_case(case_id)
        evidence_id = str(uuid.uuid4())
        case_directory = self.evidence_directory / case_id
        case_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(case_directory, 0o700)
        stored = case_directory / f"{evidence_id}.evidence"
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        descriptor = os.open(stored, flags, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            now = utc_now()
            with self.connection() as connection:
                connection.execute(
                    """
                    INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        evidence_id,
                        case_id,
                        source_type,
                        original_filename,
                        str(stored.relative_to(self.evidence_directory)),
                        digest,
                        len(content),
                        now,
                        parser_name,
                        parser_version,
                        len(observations),
                        compact_json(metadata),
                        compact_json(quality_warnings),
                    ),
                )
                connection.executemany(
                    "INSERT INTO observations VALUES(?,?,?,?,?,?,?)",
                    [
                        (
                            str(uuid.uuid4()),
                            case_id,
                            evidence_id,
                            sequence,
                            observation.get("timestamp"),
                            str(observation.get("kind", source_type)),
                            compact_json(observation),
                        )
                        for sequence, observation in enumerate(observations, 1)
                    ],
                )
                connection.execute(
                    "UPDATE cases SET updated_at = ? WHERE id = ?", (now, case_id)
                )
                self._audit(
                    connection,
                    "evidence.ingest",
                    case_id,
                    evidence_id,
                    "success",
                    {"source_type": source_type, "sha256": digest, "records": len(observations)},
                )
        except Exception:
            stored.unlink(missing_ok=True)
            raise
        return self.get_evidence(evidence_id)

    def get_evidence(self, evidence_id: str) -> dict[str, Any]:
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM evidence WHERE id = ?", (evidence_id,)).fetchone()
        if not row:
            raise NotFoundError("evidence not found")
        return self._evidence_row(row)

    def evidence_for_case(self, case_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT * FROM evidence WHERE case_id = ? ORDER BY received_at", (case_id,)
            ).fetchall()
        return [self._evidence_row(row) for row in rows]

    def observations_for_case(self, case_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = connection.execute(
                """
                SELECT id, evidence_id, sequence_number, observed_at, kind, normalized_json
                FROM observations WHERE case_id = ? ORDER BY observed_at, evidence_id, sequence_number
                """,
                (case_id,),
            ).fetchall()
        result = []
        for row in rows:
            value = json.loads(row["normalized_json"])
            value["observation_id"] = row["id"]
            value["evidence_id"] = row["evidence_id"]
            value["sequence_number"] = row["sequence_number"]
            result.append(value)
        return result

    def get_observation(self, case_id: str, observation_id: str) -> dict[str, Any]:
        """Resolve a citation without permitting cross-case object access."""
        with self.connection() as connection:
            row = connection.execute(
                """
                SELECT id, evidence_id, sequence_number, observed_at, kind, normalized_json
                FROM observations WHERE case_id = ? AND id = ?
                """,
                (case_id, observation_id),
            ).fetchone()
            if not row:
                raise NotFoundError("observation not found in case")
            self._audit(
                connection,
                "citation.resolve",
                case_id,
                row["evidence_id"],
                "success",
                {"observation_id": observation_id},
            )
        value = json.loads(row["normalized_json"])
        value.update(
            {
                "observation_id": row["id"],
                "evidence_id": row["evidence_id"],
                "sequence_number": row["sequence_number"],
                "observed_at": row["observed_at"],
                "kind": row["kind"],
            }
        )
        return value

    def get_analysis(self, case_id: str, analysis_id: str) -> dict[str, Any]:
        """Return the canonical hashed analysis artifact within its owning case."""
        with self.connection() as connection:
            row = connection.execute(
                """
                SELECT id, case_id, created_at, engine_version, output_sha256, artifact_json
                FROM analyses WHERE case_id = ? AND id = ?
                """,
                (case_id, analysis_id),
            ).fetchone()
            if not row:
                raise NotFoundError("analysis not found in case")
            self._audit(
                connection,
                "analysis.resolve",
                case_id,
                None,
                "success",
                {"analysis_id": analysis_id},
            )
        value = dict(row)
        value["artifact"] = json.loads(value.pop("artifact_json"))
        return value

    def save_analysis(
        self,
        case_id: str,
        engine_version: str,
        summary: dict[str, Any],
        findings: list[dict[str, Any]],
    ) -> dict[str, Any]:
        analysis_id = str(uuid.uuid4())
        now = utc_now()
        artifact_json = compact_json({"summary": summary, "findings": findings})
        output_sha256 = hashlib.sha256(artifact_json.encode("utf-8")).hexdigest()
        with self.connection() as connection:
            if not connection.execute("SELECT 1 FROM cases WHERE id = ?", (case_id,)).fetchone():
                raise NotFoundError("case not found")
            connection.execute("DELETE FROM findings WHERE case_id = ?", (case_id,))
            for index, finding in enumerate(findings):
                citations = list(finding.get("citations", []))
                citations.append(
                    {
                        "type": "analysis_artifact",
                        "analysis_id": analysis_id,
                        "output_sha256": output_sha256,
                        "result_path": f"/findings/{index}",
                    }
                )
                connection.execute(
                    """
                    INSERT INTO findings(
                        id,case_id,category,title,statement,classification,confidence,
                        evidence_ids_json,citations_json,validation_steps_json,created_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        str(uuid.uuid4()),
                        case_id,
                        finding["category"],
                        finding["title"],
                        finding["statement"],
                        finding["classification"],
                        finding["confidence"],
                        compact_json(finding["evidence_ids"]),
                        compact_json(citations),
                        compact_json(finding["validation_steps"]),
                        now,
                    ),
                )
            connection.execute(
                """
                INSERT INTO analyses(
                    id,case_id,created_at,engine_version,summary_json,output_sha256,artifact_json
                ) VALUES(?,?,?,?,?,?,?)
                """,
                (
                    analysis_id,
                    case_id,
                    now,
                    engine_version,
                    compact_json(summary),
                    output_sha256,
                    artifact_json,
                ),
            )
            connection.execute("UPDATE cases SET updated_at = ? WHERE id = ?", (now, case_id))
            self._audit(
                connection,
                "case.analyze",
                case_id,
                None,
                "success",
                {"analysis_id": analysis_id, "findings": len(findings)},
            )
        return self.analysis_context(case_id)

    def analysis_context(self, case_id: str) -> dict[str, Any]:
        return self.get_case(case_id)

    def _audit(
        self,
        connection: sqlite3.Connection,
        action: str,
        case_id: str | None,
        evidence_id: str | None,
        outcome: str,
        details: dict[str, Any],
    ) -> None:
        connection.execute(
            "INSERT INTO audit_events(created_at,action,case_id,evidence_id,outcome,details_json) VALUES(?,?,?,?,?,?)",
            (utc_now(), action, case_id, evidence_id, outcome, compact_json(details)),
        )

    @staticmethod
    def _evidence_row(row: sqlite3.Row) -> dict[str, Any]:
        value = dict(row)
        value.pop("stored_filename", None)
        value["metadata"] = json.loads(value.pop("metadata_json"))
        value["quality_warnings"] = json.loads(value.pop("quality_warnings_json"))
        return value

    @staticmethod
    def _analysis_row(row: sqlite3.Row) -> dict[str, Any]:
        value = dict(row)
        value["summary"] = json.loads(value.pop("summary_json"))
        value.pop("artifact_json", None)
        return value

    @staticmethod
    def _finding_row(row: sqlite3.Row) -> dict[str, Any]:
        value = dict(row)
        value["evidence_ids"] = json.loads(value.pop("evidence_ids_json"))
        value["citations"] = json.loads(value.pop("citations_json"))
        value["validation_steps"] = json.loads(value.pop("validation_steps_json"))
        return value
