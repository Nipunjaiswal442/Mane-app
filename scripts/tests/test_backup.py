import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("backup", Path(__file__).parents[1] / "backup.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "storage").mkdir()
        (self.root / "database.dump").write_bytes(b"PGDMP fixture")
        (self.root / "storage" / "meeting.md").write_text("Published meeting")
        self.manifest = {"format": "mane-backup-v1", "files": {str(p.relative_to(self.root)): backup.sha256(p) for p in backup.regular_files(self.root)}}
        (self.root / "manifest.json").write_text(json.dumps(self.manifest))

    def tearDown(self):
        self.temp.cleanup()

    def test_valid_then_tampered_backup(self):
        backup.verify_backup(self.root)
        (self.root / "storage" / "meeting.md").write_text("tampered")
        with self.assertRaisesRegex(ValueError, "checksum"):
            backup.verify_backup(self.root)

    def test_unlisted_files_rejected(self):
        (self.root / "extra").write_text("unlisted")
        with self.assertRaisesRegex(ValueError, "file list"):
            backup.verify_backup(self.root)

    def test_symlinks_refused(self):
        (self.root / "storage" / "outside").symlink_to("/etc/passwd")
        with self.assertRaisesRegex(ValueError, "Symlinks"):
            backup.verify_backup(self.root)

    def test_path_traversal_refused(self):
        self.manifest["files"]["../outside"] = "a" * 64
        (self.root / "manifest.json").write_text(json.dumps(self.manifest))
        with self.assertRaises(ValueError):
            backup.verify_backup(self.root)


if __name__ == "__main__":
    unittest.main()
