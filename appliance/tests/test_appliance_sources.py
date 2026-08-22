#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
from importlib.machinery import SourceFileLoader
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ApplianceSourceTest(unittest.TestCase):
    def load_cli(self, app: Path, state: Path):
        os.environ["NETTAP_APP_DIR"] = str(app)
        os.environ["NETTAP_STATE_DIR"] = str(state)
        path = ROOT / "appliance/bin/nettapctl"
        spec = importlib.util.spec_from_loader("nettapctl_test", SourceFileLoader("nettapctl_test", str(path)))
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_environment_write_is_atomic_and_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env.example").write_text("A=old\nB=keep\n", encoding="utf-8")
            cli = self.load_cli(root, root / "state")
            cli.write_env({"A": "new", "C": "added"})
            self.assertEqual(cli.read_env(), {"A": "new", "B": "keep", "C": "added"})
            self.assertEqual(cli.ENV_FILE.stat().st_mode & 0o777, 0o600)

    def test_appliance_uses_production_gateway_and_100mb_limit(self):
        cli = (ROOT / "appliance/bin/nettapctl").read_text(encoding="utf-8")
        compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
        self.assertIn('["compose.yaml", "compose.production.yaml"]', cli)
        self.assertIn('"EVIDENCE_MAX_UPLOAD_BYTES": "104857600"', cli)
        self.assertIn('RAG_FILE_MAX_SIZE: "100"', compose)
        self.assertIn("DEFAULT_PINNED_MODELS", compose)

    def test_native_architecture_policy_and_pinned_isos(self):
        packer = (ROOT / "appliance/packer/nettap.pkr.hcl").read_text(encoding="utf-8")
        amd = (ROOT / "appliance/packer/amd64.pkrvars.hcl").read_text(encoding="utf-8")
        arm = (ROOT / "appliance/packer/arm64.pkrvars.hcl").read_text(encoding="utf-8")
        build = (ROOT / "scripts/build-appliance.sh").read_text(encoding="utf-8")
        self.assertIn('format               = "ova"', packer)
        self.assertIn("e907d92eeec9df64163a7e454cbc8d7755e8ddc7ed42f99dbc80c40f1a138433", amd)
        self.assertIn("9a6ce6d7e66c8abed24d24944570a495caca80b3b0007df02818e13829f27f32", arm)
        self.assertIn("native $architecture build requires", build)

    def test_no_openai_runtime_secret_or_destructive_volume_delete(self):
        appliance = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (ROOT / "appliance").rglob("*")
            if path.is_file()
            and path.suffix in {"", ".md", ".py", ".sh", ".hcl", ".pkrtpl", ".service"}
            and path.name != "test_appliance_sources.py"
        )
        self.assertNotIn("OPENAI_API_KEY=", appliance)
        self.assertNotIn("down -v", appliance)


if __name__ == "__main__":
    unittest.main()
