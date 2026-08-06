"""Run the NetTAP evidence service."""

from __future__ import annotations

import os

from .config import Config
from .database import Repository
from .http_api import serve
from .service import EvidenceService


def main() -> None:
    os.umask(0o077)
    config = Config.from_environment()
    repository = Repository(config.database_path, config.evidence_directory)
    service = EvidenceService(repository, config.max_records)
    serve(
        config.host,
        config.port,
        service,
        repository,
        config.api_token,
        config.max_upload_bytes,
    )


if __name__ == "__main__":
    main()
