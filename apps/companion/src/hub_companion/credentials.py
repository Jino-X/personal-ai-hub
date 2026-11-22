"""Device credential storage.

The refresh token is the device's long-lived secret. It is written atomically to a
file readable only by the current user (0600) inside a 0700 directory, and rotated
on every token refresh.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass
class Credentials:
    server_url: str
    device_id: str
    refresh_token: str
    device_name: str
    paired_at: str


def load(path: Path) -> Credentials | None:
    try:
        data = json.loads(path.read_text("utf-8"))
        return Credentials(**data)
    except FileNotFoundError:
        return None
    except (json.JSONDecodeError, TypeError) as exc:
        raise RuntimeError(f"Credential file {path} is corrupt; run `hub-companion unpair` and pair again.") from exc


def save(path: Path, creds: Credentials) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".credentials-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(asdict(creds), fh, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def delete(path: Path) -> bool:
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False
