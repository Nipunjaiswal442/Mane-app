import hashlib
import os
import shutil
import tempfile
from pathlib import Path, PurePosixPath

from mane_worker.config import Settings, appliance_url


def safe_key(key: str) -> str:
    parts = PurePosixPath(key).parts
    if not key or key.startswith("/") or ".." in parts or "\\" in key or "\x00" in key:
        raise ValueError("Invalid storage key")
    return key


def metadata(key: str, source: str, mime: str) -> dict:
    digest = hashlib.sha256()
    with open(source, "rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return {
        "storageKey": key,
        "mime": mime,
        "bytes": Path(source).stat().st_size,
        "sha256": digest.hexdigest(),
    }


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, key: str) -> Path:
        path = (self.root / safe_key(key)).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("Storage path escapes storage root")
        return path

    def download(self, key: str, destination: str) -> None:
        shutil.copyfile(self.path(key), destination)

    def upload(self, key: str, source: str, mime: str) -> dict:
        target = self.path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".mane-", dir=target.parent)
        try:
            with os.fdopen(fd, "wb") as output, open(source, "rb") as input_file:
                shutil.copyfileobj(input_file, output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return metadata(key, source, mime)


class S3Storage:
    def __init__(self):
        import boto3
        from botocore.config import Config

        endpoint = appliance_url(os.environ["S3_ENDPOINT"])
        self.bucket = os.environ["S3_BUCKET"]
        # Explicit credentials avoid SDK attempts to contact EC2 metadata services.
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=os.environ["S3_ACCESS_KEY"],
            aws_secret_access_key=os.environ["S3_SECRET_KEY"],
            region_name=os.getenv("S3_REGION", "us-east-1"),
            config=Config(s3={"addressing_style": "path"}, proxies={}, retries={"max_attempts": 3}),
        )

    def download(self, key: str, destination: str) -> None:
        self.client.download_file(self.bucket, safe_key(key), destination)

    def upload(self, key: str, source: str, mime: str) -> dict:
        self.client.upload_file(source, self.bucket, safe_key(key), ExtraArgs={"ContentType": mime})
        return metadata(key, source, mime)


def create_storage(settings: Settings):
    backend = os.getenv("STORAGE_BACKEND", "local")
    if backend == "local":
        return LocalStorage(settings.storage_path)
    if backend == "s3":
        return S3Storage()
    raise ValueError(f"Unknown STORAGE_BACKEND {backend!r}")
