"""Runtime configuration with fail-closed validation."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    api_token: str
    database_path: Path
    evidence_directory: Path
    max_upload_bytes: int
    max_records: int

    @classmethod
    def from_environment(cls) -> "Config":
        token = os.environ.get("EVIDENCE_API_TOKEN", "")
        if len(token) < 32 or token == "GENERATE_ON_FIRST_START":
            raise RuntimeError(
                "EVIDENCE_API_TOKEN must be a generated secret of at least 32 characters"
            )

        port = _bounded_integer("NETTAP_EVIDENCE_PORT", 8081, 1, 65535)
        max_upload = _bounded_integer(
            "NETTAP_EVIDENCE_MAX_UPLOAD_BYTES", 50 * 1024 * 1024, 1024, 1024**3
        )
        max_records = _bounded_integer(
            "NETTAP_EVIDENCE_MAX_RECORDS", 100_000, 1, 1_000_000
        )
        database = Path(
            os.environ.get("NETTAP_EVIDENCE_DB", "/data/nettap-evidence.db")
        ).resolve()
        evidence = Path(
            os.environ.get("NETTAP_EVIDENCE_DATA_DIR", "/data/files")
        ).resolve()
        if database == evidence or evidence in database.parents:
            raise RuntimeError("Database and evidence-file paths must not overlap")

        return cls(
            host=os.environ.get("NETTAP_EVIDENCE_HOST", "0.0.0.0"),
            port=port,
            api_token=token,
            database_path=database,
            evidence_directory=evidence,
            max_upload_bytes=max_upload,
            max_records=max_records,
        )


def _bounded_integer(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value
