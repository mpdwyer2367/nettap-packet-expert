#!/usr/bin/env python3
"""Create or update the NetTAP PCAP Expert workspace model."""

import argparse
import asyncio
import json
import sqlite3
from pathlib import Path

from open_webui.models.models import ModelForm, Models


def find_admin_id(database_path: Path) -> str:
    with sqlite3.connect(database_path) as database:
        row = database.execute(
            "SELECT id FROM user WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1"
        ).fetchone()
    if not row:
        raise RuntimeError('No administrator account exists in Open WebUI')
    return row[0]


async def install(definition_path: Path, database_path: Path) -> None:
    definition = json.loads(definition_path.read_text(encoding='utf-8'))
    knowledge = definition.get('meta', {}).get('knowledge')
    if isinstance(knowledge, list):
        with sqlite3.connect(database_path) as database:
            existing_ids = {
                row[0] for row in database.execute('SELECT id FROM knowledge').fetchall()
            }
        definition['meta']['knowledge'] = [
            item for item in knowledge if item.get('id') in existing_ids
        ]
    form = ModelForm.model_validate(definition)
    owner_id = find_admin_id(database_path)
    existing = await Models.get_model_by_id(form.id)
    if existing:
        result = await Models.update_model_by_id(form.id, form)
        action = 'updated'
    else:
        result = await Models.insert_new_model(form, owner_id)
        action = 'created'
    if result is None:
        raise RuntimeError(f'Open WebUI failed to {action.rstrip("d")} {form.id}')
    print(json.dumps({'status': action, 'id': result.id, 'name': result.name}, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('definition', type=Path)
    parser.add_argument(
        '--database',
        type=Path,
        default=Path('/app/backend/data/webui.db'),
    )
    args = parser.parse_args()
    asyncio.run(install(args.definition, args.database))


if __name__ == '__main__':
    main()
