#!/usr/bin/env python3
"""Generate a deterministic CycloneDX inventory from an installed appliance."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


def packages() -> list[dict[str, object]]:
    output = subprocess.check_output(
        ["dpkg-query", "-W", "-f=${binary:Package}\t${Version}\t${Architecture}\n"],
        text=True,
    )
    components: list[dict[str, object]] = []
    for line in sorted(output.splitlines()):
        name, version, architecture = line.split("\t", 2)
        plain_name = name.split(":", 1)[0]
        components.append(
            {
                "type": "library",
                "name": plain_name,
                "version": version,
                "purl": (
                    f"pkg:deb/ubuntu/{quote(plain_name)}@{quote(version)}"
                    f"?arch={quote(architecture)}"
                ),
                "properties": [
                    {"name": "nettap:package-architecture", "value": architecture}
                ],
            }
        )
    return components


def image_components(env_file: Path) -> list[dict[str, object]]:
    values: dict[str, str] = {}
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            values[key] = value
    result: list[dict[str, object]] = []
    for key in ("OLLAMA_IMAGE", "OPEN_WEBUI_IMAGE", "CADDY_IMAGE", "BACKUP_IMAGE"):
        reference = values.get(key, "")
        if reference:
            result.append(
                {
                    "type": "container",
                    "name": key.lower().removesuffix("_image"),
                    "version": reference,
                    "properties": [
                        {"name": "nettap:image-reference", "value": reference}
                    ],
                }
            )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("--release", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--timestamp", default=os.environ.get("SOURCE_DATE_EPOCH", ""))
    args = parser.parse_args()

    if args.timestamp:
        created = datetime.fromtimestamp(int(args.timestamp), timezone.utc)
    else:
        created = datetime.now(timezone.utc)
    document = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "serialNumber": f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, f'nettap:{args.commit}:{args.release}')}",
        "version": 1,
        "metadata": {
            "timestamp": created.isoformat().replace("+00:00", "Z"),
            "component": {
                "type": "application",
                "name": "NetTAP Network Intelligence Appliance",
                "version": args.release,
                "properties": [
                    {"name": "nettap:source-commit", "value": args.commit}
                ],
            },
        },
        "components": packages() + image_components(args.env_file),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
