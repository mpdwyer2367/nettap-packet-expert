import importlib.util
import io
from pathlib import Path
import sqlite3
import sys
import tempfile
import types
import unittest
from unittest import mock


fake_bcrypt = types.ModuleType("bcrypt")
fake_bcrypt.gensalt = lambda: b"test-salt"
fake_bcrypt.hashpw = lambda password, _salt: b"test-hash:" + password
fake_bcrypt.checkpw = lambda password, stored: stored == b"test-hash:" + password
sys.modules.setdefault("bcrypt", fake_bcrypt)

script = Path(__file__).resolve().parents[1] / "scripts/recover_open_webui_admin.py"
spec = importlib.util.spec_from_file_location("recover_open_webui_admin", script)
recovery = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(recovery)


class AdministratorRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=Path.cwd())
        self.database = Path(self.temporary.name) / "webui.db"
        db = sqlite3.connect(self.database)
        db.execute("CREATE TABLE auth (id TEXT PRIMARY KEY, email TEXT UNIQUE, password TEXT)")
        db.execute("CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, role TEXT)")
        db.execute("INSERT INTO auth VALUES (?, ?, ?)", ("admin-1", "retained@example.test", "old-hash"))
        db.execute("INSERT INTO user VALUES (?, ?, ?, ?)", ("admin-1", "retained@example.test", "Retained", "admin"))
        db.commit()
        db.close()

    def tearDown(self):
        self.temporary.cleanup()

    def run_recovery(self, password="Ntp!9UnitTestPassword", email=None):
        environment = {}
        if email is not None:
            environment[recovery.RECOVERY_EMAIL_ENV] = email
        with mock.patch.object(recovery, "DATABASE", str(self.database)), mock.patch.object(
            sys, "stdin", io.StringIO(password + "\n")
        ), mock.patch.dict("os.environ", environment, clear=True):
            return recovery.main()

    def test_recovers_single_admin_and_preserves_identity(self):
        self.assertEqual(self.run_recovery(), 0)
        db = sqlite3.connect(self.database)
        auth = db.execute("SELECT email, password FROM auth WHERE id = ?", ("admin-1",)).fetchone()
        user = db.execute("SELECT email, name, role FROM user WHERE id = ?", ("admin-1",)).fetchone()
        db.close()
        self.assertEqual(auth, ("admin@nettap.local", "test-hash:Ntp!9UnitTestPassword"))
        self.assertEqual(user, ("admin@nettap.local", "NetTAP Administrator", "admin"))

    def test_refuses_multiple_administrators_without_changes(self):
        db = sqlite3.connect(self.database)
        db.execute("INSERT INTO auth VALUES (?, ?, ?)", ("admin-2", "second@example.test", "second-hash"))
        db.execute("INSERT INTO user VALUES (?, ?, ?, ?)", ("admin-2", "second@example.test", "Second", "admin"))
        db.commit()
        db.close()
        with self.assertRaisesRegex(SystemExit, "exactly one administrator"):
            self.run_recovery()
        db = sqlite3.connect(self.database)
        original = db.execute("SELECT email, password FROM auth WHERE id = ?", ("admin-1",)).fetchone()
        db.close()
        self.assertEqual(original, ("retained@example.test", "old-hash"))

    def test_recovers_selected_canonical_admin_when_multiple_exist(self):
        db = sqlite3.connect(self.database)
        db.execute(
            "UPDATE auth SET email = ? WHERE id = ?", ("admin@nettap.local", "admin-1")
        )
        db.execute(
            "UPDATE user SET email = ? WHERE id = ?", ("admin@nettap.local", "admin-1")
        )
        db.execute("INSERT INTO auth VALUES (?, ?, ?)", ("admin-2", "second@example.test", "second-hash"))
        db.execute("INSERT INTO user VALUES (?, ?, ?, ?)", ("admin-2", "second@example.test", "Second", "admin"))
        db.commit()
        db.close()

        self.assertEqual(self.run_recovery(email="admin@nettap.local"), 0)
        db = sqlite3.connect(self.database)
        selected = db.execute(
            "SELECT email, password FROM auth WHERE id = ?", ("admin-1",)
        ).fetchone()
        other = db.execute(
            "SELECT email, password FROM auth WHERE id = ?", ("admin-2",)
        ).fetchone()
        db.close()
        self.assertEqual(selected, ("admin@nettap.local", "test-hash:Ntp!9UnitTestPassword"))
        self.assertEqual(other, ("second@example.test", "second-hash"))

    def test_refuses_unknown_selected_administrator_without_changes(self):
        with self.assertRaisesRegex(SystemExit, "matched 0 accounts"):
            self.run_recovery(email="missing@example.test")
        db = sqlite3.connect(self.database)
        original = db.execute(
            "SELECT email, password FROM auth WHERE id = ?", ("admin-1",)
        ).fetchone()
        db.close()
        self.assertEqual(original, ("retained@example.test", "old-hash"))


if __name__ == "__main__":
    unittest.main()
