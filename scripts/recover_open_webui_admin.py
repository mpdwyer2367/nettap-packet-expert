#!/usr/bin/env python3
"""Reset one retained Open WebUI administrator without exposing the password in process arguments."""

from __future__ import annotations

import os
import sqlite3
import sys

import bcrypt


CANONICAL_EMAIL = "admin@nettap.local"
CANONICAL_NAME = "NetTAP Administrator"
DATABASE = "/app/backend/data/webui.db"
RECOVERY_EMAIL_ENV = "NETTAP_RECOVERY_ADMIN_EMAIL"


def main() -> int:
    password = sys.stdin.readline().rstrip("\r\n")
    if not password:
        raise SystemExit("recovery password was not provided")

    database = sqlite3.connect(DATABASE, timeout=30)
    try:
        database.execute("BEGIN IMMEDIATE")
        recovery_email = os.environ.get(RECOVERY_EMAIL_ENV, "").strip()
        if recovery_email:
            admins = database.execute(
                "SELECT a.id FROM auth AS a JOIN user AS u ON u.id = a.id "
                "WHERE u.role = ? AND (lower(a.email) = lower(?) OR lower(u.email) = lower(?))",
                ("admin", recovery_email, recovery_email),
            ).fetchall()
            failure = f"selected administrator {recovery_email!r} matched {len(admins)} accounts"
        else:
            admins = database.execute(
                "SELECT a.id FROM auth AS a JOIN user AS u ON u.id = a.id WHERE u.role = ?",
                ("admin",),
            ).fetchall()
            failure = f"recovery requires exactly one administrator; found {len(admins)}"
        if len(admins) != 1:
            database.rollback()
            raise SystemExit(failure)

        admin_id = admins[0][0]
        auth_conflict = database.execute(
            "SELECT id FROM auth WHERE lower(email) = lower(?) AND id <> ?",
            (CANONICAL_EMAIL, admin_id),
        ).fetchone()
        user_conflict = database.execute(
            "SELECT id FROM user WHERE lower(email) = lower(?) AND id <> ?",
            (CANONICAL_EMAIL, admin_id),
        ).fetchone()
        if auth_conflict or user_conflict:
            database.rollback()
            raise SystemExit("canonical administrator email belongs to another account")

        password_hash = bcrypt.hashpw(
            password.encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")
        database.execute(
            "UPDATE auth SET email = ?, password = ? WHERE id = ?",
            (CANONICAL_EMAIL, password_hash, admin_id),
        )
        database.execute(
            "UPDATE user SET email = ?, name = ? WHERE id = ?",
            (CANONICAL_EMAIL, CANONICAL_NAME, admin_id),
        )
        database.commit()

        stored = database.execute(
            "SELECT password FROM auth WHERE id = ?", (admin_id,)
        ).fetchone()
        identity = database.execute(
            "SELECT a.email, u.email, u.name, u.role "
            "FROM auth AS a JOIN user AS u ON u.id = a.id WHERE a.id = ?",
            (admin_id,),
        ).fetchone()
        if (
            not stored
            or not bcrypt.checkpw(
                password.encode("utf-8"), stored[0].encode("utf-8")
            )
            or identity != (CANONICAL_EMAIL, CANONICAL_EMAIL, CANONICAL_NAME, "admin")
        ):
            raise SystemExit("administrator recovery verification failed")
    finally:
        database.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
