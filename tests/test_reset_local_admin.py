import io
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from provisioning import reset_local_admin


class ResetLocalAdminTests(unittest.TestCase):
    def test_hash_password_uses_open_webui_bcrypt_dependency(self):
        fake_bcrypt = SimpleNamespace(
            gensalt=lambda: b"salt",
            hashpw=lambda password, salt: b"bcrypt-hash"
            if password == b"password" and salt == b"salt"
            else b"unexpected",
        )
        with patch.dict("sys.modules", {"bcrypt": fake_bcrypt}):
            self.assertEqual(reset_local_admin.hash_password("password"), "bcrypt-hash")

    def test_hash_password_rejects_more_than_72_bytes(self):
        fake_bcrypt = SimpleNamespace(gensalt=lambda: b"salt", hashpw=lambda *_: b"hash")
        with patch.dict("sys.modules", {"bcrypt": fake_bcrypt}):
            with self.assertRaises(SystemExit):
                reset_local_admin.hash_password("x" * 73)

    def test_existing_admin_is_reset_without_deleting_other_data(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "webui.db"
            connection = sqlite3.connect(database)
            connection.execute(
                "CREATE TABLE user "
                "(id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, role TEXT, created_at INTEGER)"
            )
            connection.execute(
                "CREATE TABLE auth "
                "(id TEXT PRIMARY KEY, email TEXT UNIQUE, password TEXT)"
            )
            connection.execute(
                "CREATE TABLE chat (id TEXT PRIMARY KEY, title TEXT)"
            )
            connection.execute(
                "INSERT INTO user VALUES (?, ?, ?, ?, ?)",
                ("u1", "Old Admin", "old@example.test", "admin", 1),
            )
            connection.execute(
                "INSERT INTO auth VALUES (?, ?, ?)",
                ("u1", "old@example.test", "old-hash"),
            )
            connection.execute(
                "INSERT INTO chat VALUES (?, ?)", ("c1", "Preserved chat")
            )
            connection.commit()
            connection.close()

            with (
                patch.object(reset_local_admin, "DATABASE", database),
                patch.object(reset_local_admin, "CREATE_IF_MISSING", True),
                patch.object(
                    reset_local_admin,
                    "hash_password",
                    return_value="open-webui-compatible-hash",
                ),
                patch("sys.stdin", io.StringIO("password\n")),
            ):
                reset_local_admin.main()

            connection = sqlite3.connect(database)
            self.assertEqual(
                connection.execute(
                    "SELECT name, email, role FROM user WHERE id = ?", ("u1",)
                ).fetchone(),
                ("NetTAP Administrator", "admin@nettaptech.com", "admin"),
            )
            self.assertEqual(
                connection.execute(
                    "SELECT email, password FROM auth WHERE id = ?", ("u1",)
                ).fetchone(),
                ("admin@nettaptech.com", "open-webui-compatible-hash"),
            )
            self.assertEqual(
                connection.execute("SELECT title FROM chat WHERE id = ?", ("c1",)).fetchone(),
                ("Preserved chat",),
            )
            connection.close()
            self.assertEqual(
                len(list(Path(directory).glob("webui.db.pre-local-admin-reset-*.bak"))),
                1,
            )


if __name__ == "__main__":
    unittest.main()
