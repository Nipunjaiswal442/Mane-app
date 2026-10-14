"""Consistent, checksummed local backups. No cloud clients and no destructive overwrite."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent


def sha256(file):
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def regular_files(directory):
    for file in sorted(directory.rglob("*")):
        if file.is_symlink():
            raise ValueError(f"Symlinks are refused: {file}")
        if file.is_file():
            yield file
        elif not file.is_dir():
            raise ValueError(f"Special file refused: {file}")


def verify_backup(directory):
    if directory.is_symlink():
        raise ValueError("Backup directory cannot be a symlink")
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest.get("format") != "mane-backup-v1" or not isinstance(manifest.get("files"), dict):
        raise ValueError("Invalid backup manifest")
    actual = {str(p.relative_to(directory)) for p in regular_files(directory)} - {"manifest.json"}
    if actual != set(manifest["files"]) or "database.dump" not in actual:
        raise ValueError("Backup file list differs from manifest")
    for name, digest in manifest["files"].items():
        target = directory / name
        if Path(name).is_absolute() or ".." in Path(name).parts or not target.resolve().is_relative_to(directory.resolve()):
            raise ValueError("Unsafe backup path")
        if not re.fullmatch(r"[a-f0-9]{64}", digest) or sha256(target) != digest:
            raise ValueError(f"Backup checksum mismatch: {name}")
    return manifest


def postgres(args, command):
    return ["docker", "compose", "-f", args.compose, "exec", "-T", args.service, *command]


def backup(args):
    source = args.storage.resolve()
    destination = args.path.resolve()
    if args.storage.is_symlink() or not source.is_dir():
        raise ValueError("Storage must be an existing directory, not a symlink")
    if destination.exists() or destination.is_relative_to(source):
        raise ValueError("Backup destination must be new and outside storage")
    list(regular_files(source))
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix=".mane-backup-", dir=destination.parent))
    try:
        with (temp / "database.dump").open("wb") as stream:
            subprocess.run(postgres(args, ["pg_dump", "-U", args.user, "-d", args.database, "--format=custom", "--no-owner", "--no-acl"]), stdout=stream, check=True)
        shutil.copytree(source, temp / "storage", symlinks=True)
        files = {str(p.relative_to(temp)): sha256(p) for p in regular_files(temp)}
        manifest = {"format": "mane-backup-v1", "created_at": datetime.now(timezone.utc).isoformat(), "database": args.database, "files": files}
        (temp / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        verify_backup(temp)
        temp.rename(destination)
    finally:
        if temp.exists():
            shutil.rmtree(temp)
    print(f"Backup verified: {destination}")


def restore(args):
    if args.path.is_symlink():
        raise ValueError("Backup directory cannot be a symlink")
    source = args.path.resolve()
    verify_backup(source)
    target = args.storage.resolve()
    if args.storage.is_symlink() or target == ROOT or target == Path("/") or target == source or target.is_relative_to(source):
        raise ValueError("Unsafe restore storage path")
    if target.exists() and (not target.is_dir() or any(target.iterdir())):
        raise ValueError("Restore refuses existing storage content; select a fresh empty directory")
    query = "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')"
    result = subprocess.run(postgres(args, ["psql", "-U", args.user, "-d", args.database, "-Atc", query]), capture_output=True, text=True, check=True)
    if result.stdout.strip() != "0":
        raise ValueError("Restore refuses a nonempty database; create a fresh database first")
    target.parent.mkdir(parents=True, exist_ok=True)
    staged = Path(tempfile.mkdtemp(prefix=".mane-restore-", dir=target.parent))
    try:
        shutil.copytree(source / "storage", staged / "storage", symlinks=False)
        with (source / "database.dump").open("rb") as stream:
            subprocess.run(postgres(args, ["pg_restore", "-U", args.user, "-d", args.database, "--single-transaction", "--exit-on-error", "--no-owner", "--no-acl"]), stdin=stream, check=True)
        if target.exists():
            target.rmdir()
        (staged / "storage").rename(target)
    finally:
        shutil.rmtree(staged)
    print(f"Restored to fresh database {args.database} and storage {target}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["backup", "restore"])
    parser.add_argument("path", type=Path, help="backup directory")
    parser.add_argument("--storage", type=Path, default=Path(os.getenv("DATA_DIR", ROOT / "data")))
    parser.add_argument("--compose", default="infra/compose.dev.yml")
    parser.add_argument("--service", default="postgres")
    parser.add_argument("--database", default="mane")
    parser.add_argument("--user", default="mane")
    parser.add_argument("--quiesced", action="store_true", help="confirm app/worker writes are stopped for a consistent snapshot")
    args = parser.parse_args()
    if not args.quiesced:
        parser.error("Stop API and worker writes, then pass --quiesced. PostgreSQL remains running.")
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", args.database):
        parser.error("Use a simple PostgreSQL database identifier")
    try:
        (backup if args.action == "backup" else restore)(args)
    except (ValueError, OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        parser.exit(1, f"Backup operation failed: {exc}\n")


if __name__ == "__main__":
    main()
