#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "manage_open_webui_user",
    ROOT / "provisioning" / "manage_open_webui_user.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class AccountInputValidationTests(unittest.TestCase):
    def test_normalizes_email(self):
        self.assertEqual(MODULE.normalize_email(" Admin@Example.COM "), "admin@example.com")

    def test_rejects_invalid_email(self):
        with self.assertRaises(MODULE.AccountRecoveryError):
            MODULE.normalize_email("not-an-email")

    def test_accepts_eight_character_policy(self):
        MODULE.validate_password("Valid1!a")

    def test_rejects_missing_character_classes(self):
        for password in ("alllower1!", "ALLUPPER1!", "NoNumber!", "NoSymbol1"):
            with self.subTest(password=password):
                with self.assertRaises(MODULE.AccountRecoveryError):
                    MODULE.validate_password(password)

    def test_rejects_short_and_oversized_passwords(self):
        for password in ("S1!aaaa", "A1!" + "a" * 70):
            with self.subTest(length=len(password)):
                with self.assertRaises(MODULE.AccountRecoveryError):
                    MODULE.validate_password(password)


if __name__ == "__main__":
    unittest.main()
