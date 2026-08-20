#!/usr/bin/env python3
"""Create or recover one local Open WebUI account without exposing credentials."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import re
import sqlite3
import sys
import time
import uuid


EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PASSWORD_PATTERN = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,72}$")
DATA_DIR = Path("/app/backend/data")


class AccountRecoveryError(RuntimeError):
    pass


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if not EMAIL_PATTERN.fullmatch(email):
        raise AccountRecoveryError("a valid email address is required")
    return email


def validate_password(value: str) -> None:
    if "\n" in value or "\r" in value:
        raise AccountRecoveryError("passwords cannot contain line breaks")
    if not PASSWORD_PATTERN.fullmatch(value):
        raise AccountRecoveryError(
            "password must be 8-72 characters and include upper, lower, number, and symbol"
        )
    if len(value.encode("utf-8")) > 72:
        raise AccountRecoveryError("password must not exceed 72 UTF-8 bytes")


def read_password() -> str:
    password = sys.stdin.readline().rstrip("\r\n")
    if not password:
        raise AccountRecoveryError("password was not supplied on standard input")
    validate_password(password)
    return password


def backup_database() -> Path:
    source = DATA_DIR / "webui.db"
    if not source.is_file():
        raise AccountRecoveryError(f"Open WebUI database was not found at {source}")
    destination_dir = DATA_DIR / "nettap-account-recovery"
    destination_dir.mkdir(mode=0o700, exist_ok=True)
    timestamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    destination = destination_dir / f"webui-before-account-change-{timestamp}.db"
    if destination.exists():
        raise AccountRecoveryError(f"recovery backup already exists: {destination}")
    source_db = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    destination_db = sqlite3.connect(destination)
    try:
        source_db.backup(destination_db)
        check = destination_db.execute("PRAGMA quick_check").fetchone()
        if not check or check[0] != "ok":
            raise AccountRecoveryError("recovery backup failed SQLite integrity validation")
    finally:
        destination_db.close()
        source_db.close()
    destination.chmod(0o600)
    return destination


async def manage_account(args: argparse.Namespace, password: str) -> dict[str, str]:
    from open_webui.internal.db import get_async_db_context
    from open_webui.models.auths import Auth, Auths
    from open_webui.models.users import User
    from open_webui.utils.auth import get_password_hash, verify_password
    from sqlalchemy import func, select

    email = normalize_email(args.email)
    password_hash = await get_password_hash(password)
    now = int(time.time())
    async with get_async_db_context() as session:
        query = select(User).where(func.lower(User.email) == email)
        user = (await session.execute(query)).scalars().first()
        if user is None:
            if not args.create_if_missing:
                raise AccountRecoveryError(
                    "account does not exist; rerun with --create-if-missing after verifying the address"
                )
            user_id = str(uuid.uuid4())
            user = User(
                id=user_id,
                email=email,
                name=args.name,
                role=args.role,
                profile_image_url="/user.png",
                last_active_at=now,
                updated_at=now,
                created_at=now,
            )
            session.add(user)
            session.add(Auth(id=user_id, email=email, password=password_hash, active=True))
            action = "created"
        else:
            credential = await session.get(Auth, user.id)
            if credential is None:
                raise AccountRecoveryError("account exists but its local password record is missing")
            credential.password = password_hash
            credential.email = email
            credential.active = True
            user.role = args.role
            user.updated_at = now
            user_id = user.id
            action = "reset"
        await session.commit()

    verified = await Auths.authenticate_user(
        email,
        lambda stored_hash: verify_password(password, stored_hash),
    )
    if verified is None or verified.id != user_id:
        raise AccountRecoveryError("credential verification failed after the account change")

    return {"action": action, "email": email, "role": args.role, "user_id": user_id}


async def verify_account(args: argparse.Namespace, password: str) -> dict[str, str]:
    from open_webui.models.auths import Auths
    from open_webui.utils.auth import verify_password

    email = normalize_email(args.email)
    user = await Auths.authenticate_user(
        email,
        lambda stored_hash: verify_password(password, stored_hash),
    )
    if user is None:
        raise AccountRecoveryError("credential verification failed")
    return {"action": "verified", "email": email, "role": user.role, "user_id": user.id}


def append_audit_record(result: dict[str, str], backup: Path | None) -> None:
    record = {
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "action": result["action"],
        "email": result["email"],
        "role": result["role"],
        "user_id": result["user_id"],
    }
    if backup is not None:
        record["backup"] = str(backup)
    audit_path = DATA_DIR / "nettap-account-recovery.jsonl"
    with audit_path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record, sort_keys=True) + "\n")
    audit_path.chmod(0o600)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    manage = subparsers.add_parser("manage")
    manage.add_argument("--email", required=True)
    manage.add_argument("--name", default="NetTAP Administrator")
    manage.add_argument("--role", choices=("admin", "user"), default="user")
    manage.add_argument("--create-if-missing", action="store_true")
    verify = subparsers.add_parser("verify")
    verify.add_argument("--email", required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        password = read_password()
        if args.command == "manage":
            backup = backup_database()
            print(f"Recovery backup: {backup}", file=sys.stderr)
            result = asyncio.run(manage_account(args, password))
            append_audit_record(result, backup)
            result["backup"] = str(backup)
        else:
            result = asyncio.run(verify_account(args, password))
        print(json.dumps(result, sort_keys=True))
        return 0
    except AccountRecoveryError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 4
    except Exception as exc:
        print(f"ERROR: account recovery failed ({type(exc).__name__})", file=sys.stderr)
        return 5
    finally:
        if "password" in locals():
            del password


if __name__ == "__main__":
    raise SystemExit(main())
