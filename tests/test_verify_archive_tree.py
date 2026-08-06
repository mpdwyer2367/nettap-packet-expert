#!/usr/bin/env python3
"""Tests for fail-closed verification of packaged Git tree identity."""

from __future__ import annotations

import io
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
VERIFIER = ROOT / "scripts/verify-archive-tree.py"


class ArchiveTreeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.repository = self.root / "repo"
        self.repository.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=self.repository, check=True)
        subprocess.run(["git", "config", "user.name", "NetTAP Test"], cwd=self.repository, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=self.repository, check=True)
        (self.repository / "README.md").write_text("release candidate\n", encoding="utf-8")
        script = self.repository / "run.sh"
        script.write_text("#!/usr/bin/env bash\necho ready\n", encoding="utf-8")
        script.chmod(0o755)
        subprocess.run(["git", "add", "."], cwd=self.repository, check=True)
        subprocess.run(["git", "commit", "-qm", "fixture"], cwd=self.repository, check=True)
        self.tree = subprocess.check_output(
            ["git", "rev-parse", "HEAD^{tree}"], cwd=self.repository, text=True
        ).strip()
        self.archive = self.root / "candidate.tar.gz"
        subprocess.run(
            [
                "git",
                "archive",
                "--format=tar.gz",
                "--prefix=nettap-ai-suite-0.3.0-rc.5/",
                f"--output={self.archive}",
                "HEAD",
            ],
            cwd=self.repository,
            check=True,
        )

    def tearDown(self):
        self.temporary.cleanup()

    def verify(self, archive: Path, tree: str | None = None):
        return subprocess.run(
            [
                "python3",
                str(VERIFIER),
                str(archive),
                "--expected-prefix",
                "nettap-ai-suite-0.3.0-rc.5",
                "--expected-tree",
                tree or self.tree,
            ],
            text=True,
            capture_output=True,
        )

    def test_accepts_exact_git_archive_tree(self):
        result = self.verify(self.archive)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(self.tree, result.stdout)

    def test_rejects_wrong_tree_identity(self):
        result = self.verify(self.archive, "0" * 40)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not match", result.stderr)

    def test_rejects_duplicate_archive_member(self):
        duplicate = self.root / "duplicate.tar.gz"
        with tarfile.open(duplicate, "w:gz") as archive:
            for content in (b"first\n", b"second\n"):
                member = tarfile.TarInfo("nettap-ai-suite-0.3.0-rc.5/README.md")
                member.size = len(content)
                member.mode = 0o644
                archive.addfile(member, io.BytesIO(content))
        result = self.verify(duplicate)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("duplicate archive path", result.stderr)


if __name__ == "__main__":
    unittest.main()
