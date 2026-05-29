import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


STATUS_SCHEMA_VERSION = 1
MAX_ERROR_LENGTH = 320


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def parse_automation_version(path):
    try:
        header = Path(path).read_text(encoding="utf-8", errors="replace")[:4096]
    except OSError:
        return None

    for pattern in (
        r"myAutomation\.h[^\n]*(v\d+(?:\.\d+)+(?:[-A-Za-z0-9_.]*)?)",
        r"\((v\d+(?:\.\d+)+(?:[-A-Za-z0-9_.]*)?)\)",
        r"\bv\d+(?:\.\d+)+(?:[-A-Za-z0-9_.]*)?\b",
    ):
        match = re.search(pattern, header)
        if match:
            return match.group(1) if match.lastindex else match.group(0)
    return None


def git_metadata(repo_path, expected_ref=None, repo_url=None):
    repo_path = Path(repo_path)
    return {
        "url": redact_url(repo_url) if repo_url else None,
        "ref": expected_ref,
        "checkedOutRef": git_output(repo_path, ["symbolic-ref", "--short", "-q", "HEAD"]) or None,
        "commit": git_output(repo_path, ["rev-parse", "HEAD"]) or None,
    }


def git_output(repo_path, args):
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_path), *args],
            text=True,
            capture_output=True,
            check=False,
        )
    except OSError:
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def redact_url(url):
    if not url:
        return url
    try:
        parsed = urlsplit(url)
    except ValueError:
        return sanitize_error(url)
    if "@" not in parsed.netloc:
        return sanitize_error(url)
    host = parsed.netloc.rsplit("@", 1)[-1]
    return sanitize_error(urlunsplit((parsed.scheme, f"[redacted]@{host}", parsed.path, parsed.query, parsed.fragment)))


def sanitize_error(error):
    text = str(error)
    for value in secret_values():
        text = text.replace(value, "[redacted]")
    text = re.sub(r"(?i)(password|token|secret|key|ssid)=\S+", r"\1=[redacted]", text)
    if len(text) > MAX_ERROR_LENGTH:
        return f"{text[:MAX_ERROR_LENGTH - 3]}..."
    return text


def secret_values():
    needles = ("PASSWORD", "TOKEN", "SECRET", "KEY", "SSID")
    values = []
    for name, value in os.environ.items():
        if value and len(value) >= 3 and any(needle in name.upper() for needle in needles):
            values.append(value)
    return values


def read_existing_status(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def build_status_payload(
    *,
    decision,
    status,
    message,
    automation_file,
    config_file,
    tracked_hash,
    previous_hash,
    model_repo,
    model_ref,
    model_repo_url,
    commandstation_repo,
    commandstation_ref,
    commandstation_repo_url,
    target,
    sensor_setup,
    existing_status=None,
    error=None,
    recorded_at=None,
    flashed_at=None,
    baseline_at=None,
):
    existing_status = existing_status or {}
    recorded_at = recorded_at or utc_now()
    return {
        "schemaVersion": STATUS_SCHEMA_VERSION,
        "status": status,
        "decision": decision,
        "message": message,
        "recordedAt": recorded_at,
        "baselineAt": baseline_at if baseline_at is not None else existing_status.get("baselineAt"),
        "flashedAt": flashed_at if flashed_at is not None else existing_status.get("flashedAt"),
        "trackedHash": tracked_hash,
        "previousHash": previous_hash or None,
        "automation": {
            "file": str(automation_file),
            "version": parse_automation_version(automation_file),
            "hash": sha256_file(automation_file) if Path(automation_file).exists() else None,
        },
        "config": {
            "file": str(config_file),
            "hash": sha256_file(config_file) if Path(config_file).exists() else None,
        },
        "modelRepo": git_metadata(model_repo, expected_ref=model_ref, repo_url=model_repo_url),
        "commandStation": git_metadata(
            commandstation_repo,
            expected_ref=commandstation_ref,
            repo_url=commandstation_repo_url,
        ),
        "target": target,
        "postFlashSensorSetup": sensor_setup,
        "error": sanitize_error(error) if error else None,
    }


def write_status(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f"{path.name}.tmp")
    tmp_path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf-8")
    tmp_path.replace(path)
