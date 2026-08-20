#!/usr/bin/env python3
"""Reset an existing Open WebUI administrator without deleting application data."""

from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

DATABASE = Path("/app/backend/data/webui.db")
EMAIL = os.environ.get("NETTAP_RESET_ADMIN_EMAIL", "admin@nettap.local")
NAME = os.environ.get("NETTAP_RESET_ADMIN_NAME", "admin")


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(2)


def hash_password(password: str) -> str:
    # Use the same bcrypt-compatible context shipped in the pinned Open WebUI
    # image without importing the full application configuration. Importing
    # open_webui.utils.auth would unnecessarily require WEBUI_SECRET_KEY in
    # this offline maintenance container.
    from passlib.context import CryptContext

    return CryptContext(schemes=["bcrypt"], deprecated="auto").hash(password)


def main() -> None:
    password = sys.stdin.readline().rstrip("\r\n")
    if not password:
        fail("No replacement password was supplied on standard input.")
    if not DATABASE.is_file():
        fail(f"Open WebUI database does not exist: {DATABASE}")

    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    try:
        user_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(user)")
        }
        auth_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(auth)")
        }
        if not {"id", "name", "email", "role"}.issubset(user_columns):
            fail("The Open WebUI user table has an unsupported schema.")
        if not {"id", "email", "password"}.issubset(auth_columns):
            fail("The Open WebUI auth table has an unsupported schema.")

        target = connection.execute(
            "SELECT id, email FROM user WHERE email = ?", (EMAIL,)
        ).fetchone()
        if target is not None and connection.execute(
            "SELECT 1 FROM user WHERE id = ? AND role != 'admin'", (target["id"],)
        ).fetchone():
            fail(f"{EMAIL} belongs to a non-administrator account.")

        if target is None:
            target = connection.execute(
                "SELECT id, email FROM user WHERE role = 'admin' ORDER BY created_at LIMIT 1"
            ).fetchone()
        if target is None:
            fail("No existing administrator account was found; no database change was made.")

        auth = connection.execute(
            "SELECT id FROM auth WHERE id = ?", (target["id"],)
        ).fetchone()
        if auth is None:
            fail("The selected administrator has no local password record.")

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = DATABASE.with_name(f"webui.db.pre-local-admin-reset-{stamp}.bak")
        if backup_path.exists():
            fail(f"Refusing to overwrite existing backup: {backup_path}")
        backup = sqlite3.connect(backup_path)
        try:
            connection.backup(backup)
        finally:
            backup.close()

        password_hash = hash_password(password)
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "UPDATE user SET name = ?, email = ?, role = 'admin' WHERE id = ?",
                (NAME, EMAIL, target["id"]),
            )
            connection.execute(
                "UPDATE auth SET email = ?, password = ? WHERE id = ?",
                (EMAIL, password_hash, target["id"]),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise

        print(f"Administrator reset: {EMAIL}")
        print(f"Database backup: {backup_path}")
    finally:
        connection.close()
        password = ""


if __name__ == "__main__":
    main()
