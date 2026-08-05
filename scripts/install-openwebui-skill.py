#!/usr/bin/env python3
"""Install the version-controlled Packet Expert skill into Open WebUI."""

import argparse
import asyncio
import json
import sqlite3
from pathlib import Path

from open_webui.models.skills import SkillForm, Skills


def first_admin(database: Path) -> str:
    with sqlite3.connect(database) as connection:
        row = connection.execute(
            "SELECT id FROM user WHERE role='admin' ORDER BY created_at LIMIT 1"
        ).fetchone()
    if not row:
        raise RuntimeError("Create the Open WebUI administrator first.")
    return row[0]


async def install(bundle: Path, database: Path) -> None:
    entry = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))[0]
    form = SkillForm.model_validate(
        {
            "id": entry["id"],
            "name": entry["name"],
            "description": entry.get("description"),
            "content": (bundle / entry["file"]).read_text(encoding="utf-8"),
            "meta": entry.get("meta") or {},
            "is_active": True,
            "access_grants": [
                {"principal_type": "user", "principal_id": "*", "permission": "read"}
            ],
        }
    )
    existing = await Skills.get_skill_by_id(form.id)
    result = (
        await Skills.update_skill_by_id(form.id, form.model_dump())
        if existing
        else await Skills.insert_new_skill(first_admin(database), form)
    )
    if result is None:
        raise RuntimeError("Open WebUI failed to install the Packet Expert skill.")
    print(json.dumps({"id": form.id, "status": "updated" if existing else "created"}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--database", type=Path, default=Path("/app/backend/data/webui.db"))
    args = parser.parse_args()
    asyncio.run(install(args.bundle, args.database))


if __name__ == "__main__":
    main()
