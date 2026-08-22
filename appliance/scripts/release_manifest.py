#!/usr/bin/env python3
"""Create a deterministic release manifest for appliance artifacts."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
artifacts = []
for path in sorted(root.iterdir()):
    if path.is_file() and path.name not in {"release-manifest.json", "release-manifest.sigstore.json"}:
        artifacts.append({"name": path.name, "bytes": path.stat().st_size,
                          "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
manifest = {"schema": "nettap-appliance-release/v1", "artifacts": artifacts}
(root / "release-manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
