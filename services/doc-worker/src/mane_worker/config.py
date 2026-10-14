import ipaddress
import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[4]


def appliance_url(value: str) -> str:
    """Only loopback by default; appliance service names require explicit allowlisting.

    APPLIANCE_HOSTS is an operator-controlled trust boundary for isolated Docker/VLAN
    deployments. HTTP redirects and environment proxies are separately disabled.
    """
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username:
        raise ValueError("Expected an appliance HTTP(S) URL without credentials")
    appliance_host(parsed.hostname)
    return value.rstrip("/")


def appliance_host(host: str) -> None:
    host = host.lower()
    allowed = {"localhost", "127.0.0.1", "::1"}
    allowed.update(x.strip().lower() for x in os.getenv("APPLIANCE_HOSTS", "").split(",") if x)
    try:
        loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = False
    if host not in allowed and not loopback:
        raise ValueError(f"Outbound endpoint {host!r} is not an allowed appliance host")


def database_url(value: str) -> str:
    from psycopg.conninfo import conninfo_to_dict

    parameters = conninfo_to_dict(value)
    if "service" in parameters:
        raise ValueError("Use an explicit local database endpoint, not a libpq service")
    for key in ("host", "hostaddr"):
        for host in parameters.get(key, "localhost").split(","):
            if not host.startswith("/"):
                appliance_host(host)
    return value


def llm_context_tokens() -> int:
    count = int(os.getenv("LLM_CONTEXT_TOKENS", "16384"))
    if count < 4096:
        raise ValueError("LLM_CONTEXT_TOKENS must be at least 4096")
    return count


@dataclass(frozen=True)
class Settings:
    database_url: str = field(
        default_factory=lambda: database_url(
            os.getenv("DATABASE_URL", "postgresql://mane:mane@127.0.0.1:5432/mane")
        )
    )
    api_url: str = field(
        default_factory=lambda: appliance_url(os.getenv("API_URL", "http://127.0.0.1:4000"))
    )
    worker_token: str = field(default_factory=lambda: os.getenv("WORKER_TOKEN", ""))
    storage_path: Path = field(
        default_factory=lambda: Path(
            os.getenv("STORAGE_PATH", os.getenv("DATA_DIR", str(ROOT / "data")))
        ).resolve()
    )
    schema_path: Path = field(
        default_factory=lambda: Path(
            os.getenv("MINUTES_SCHEMA_PATH", str(ROOT / "packages/shared/minutes.schema.json"))
        )
    )
    template_path: Path = field(
        default_factory=lambda: Path(
            os.getenv(
                "MINUTES_TEMPLATE_PATH", str(ROOT / "services/doc-worker/templates/minutes.docx")
            )
        )
    )
    lease_seconds: int = field(
        default_factory=lambda: int(os.getenv("WORKER_LEASE_SECONDS", "300"))
    )
    poll_seconds: float = field(
        default_factory=lambda: float(os.getenv("WORKER_POLL_SECONDS", "2"))
    )
    max_attempts: int = 3
    port: int = field(default_factory=lambda: int(os.getenv("WORKER_PORT", "5000")))

    def __post_init__(self):
        if self.lease_seconds < 30:
            raise ValueError("WORKER_LEASE_SECONDS must be at least 30")
        if self.poll_seconds <= 0:
            raise ValueError("WORKER_POLL_SECONDS must be positive")
