#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import fcntl
except ImportError:
    fcntl = None


ESP32_INDEX_URL = "https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json"
ESP32_CORE = "esp32:esp32@2.0.17"
ETHERNET_LIBRARY = "Ethernet@2.0.2"
MODEL_REPO_URL = "https://github.com/chrischang314/model-railroad-automation.git"
COMMANDSTATION_REPO_URL = "https://github.com/DCC-EX/CommandStation-EX.git"
LOCK_FD = None
STATUS_SCHEMA_VERSION = 1
STATUS_FILE_NAME = "firmware-status.json"
MAX_ERROR_LENGTH = 240
AUTOMATION_VERSION_RE = re.compile(r"\bv\d+(?:\.\d+){1,3}(?:[-A-Za-z0-9.]+)?\b")
SENSITIVE_ENV_MARKERS = ("PASSWORD", "TOKEN", "SECRET", "KEY", "SSID")


def main():
    args = parse_args()
    state_dir = Path(env("STATE_DIR", "/state"))
    work_dir = Path(env("WORK_DIR", "/work"))
    state_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    lock_path = state_dir / "updater.lock"
    if not acquire_lock(lock_path):
      log("another updater instance is already running; exiting")
      return 0

    try:
        if args.once:
            return run_once(state_dir, work_dir)

        while True:
            try:
                run_once(state_dir, work_dir)
            except Exception as error:
                log(f"ERROR: {error}")
            time.sleep(int(env("POLL_SECONDS", "300")))
    finally:
        release_lock(lock_path)


def parse_args():
    parser = argparse.ArgumentParser(description="Poll GitHub and flash DCC-EX when myAutomation.h changes.")
    parser.add_argument("--once", action="store_true", help="run one poll/build/upload pass and exit")
    parser.add_argument("--force", action="store_true", help="flash even if the tracked hash has not changed")
    parsed = parser.parse_args()
    if parsed.force:
        os.environ["FORCE_FLASH"] = "true"
    return parsed


def run_once(state_dir, work_dir):
    model_repo = work_dir / "model-railroad-automation"
    cs_repo = work_dir / "CommandStation-EX"
    previous_hash_path = state_dir / "last-flashed.sha256"
    status_path = Path(env("FIRMWARE_STATUS_FILE", str(state_dir / STATUS_FILE_NAME)))
    context = build_status_context()

    try:
        sync_repo(model_repo, context["modelRepo"]["url"], context["modelRepo"]["ref"])
        sync_repo(cs_repo, context["commandStation"]["url"], context["commandStation"]["ref"])
        context["modelRepo"].update(git_metadata(model_repo))
        context["commandStation"].update(git_metadata(cs_repo))

        automation_src = model_repo / context["automation"]["file"]
        config_src = model_repo / context["automation"]["configFile"]
        if not automation_src.exists():
            raise FileNotFoundError(f"automation file not found: {automation_src}")
        if not config_src.exists():
            raise FileNotFoundError(f"config file not found: {config_src}")

        tracked_hash = hash_files([automation_src, config_src])
        previous_hash = previous_hash_path.read_text(encoding="utf-8").strip() if previous_hash_path.exists() else ""
        force_flash = bool_env("FORCE_FLASH", False)
        auto_flash = bool_env("AUTO_FLASH", True)
        context["automation"]["trackedHash"] = tracked_hash
        context["automation"]["version"] = parse_automation_version(automation_src)
        context["flash"]["previousHash"] = previous_hash or None
        context["flash"]["currentHash"] = tracked_hash
        context["flash"]["forceFlash"] = force_flash
        context["flash"]["autoFlash"] = auto_flash

        if not previous_hash and not bool_env("FLASH_ON_FIRST_RUN", False) and not force_flash:
            previous_hash_path.write_text(tracked_hash, encoding="utf-8")
            record_status(status_path, build_status_payload(
                context,
                decision="baseline-recorded",
                baseline_recorded_at=now_iso(),
            ))
            log(f"first run baseline recorded ({tracked_hash}); no flash performed")
            return 0

        if tracked_hash == previous_hash and not force_flash:
            record_status(status_path, build_status_payload(context, decision="unchanged-no-flash"))
            log(f"no change detected ({tracked_hash})")
            return 0

        log(f"change detected: {previous_hash or '<none>'} -> {tracked_hash}")
        if not auto_flash:
            record_status(status_path, build_status_payload(context, decision="auto-flash-disabled"))
            log("AUTO_FLASH=false; build/upload skipped")
            return 0

        context["flash"]["attempted"] = True
        prepare_commandstation_tree(cs_repo, automation_src, config_src)
        ensure_toolchain()
        compile_firmware(cs_repo)
        pre_flash_shutdown()
        upload_firmware(cs_repo)
        previous_hash_path.write_text(tracked_hash, encoding="utf-8")
        sensor_setup = post_flash_sensor_setup()
        record_status(status_path, build_status_payload(
            context,
            decision="success",
            flashed_at=now_iso(),
            sensor_setup=sensor_setup,
        ))
        log(f"flash complete ({tracked_hash})")
        return 0
    except Exception as error:
        record_status(status_path, build_status_payload(
            context,
            decision="failure",
            error=sanitize_error(error),
        ))
        raise


def build_status_context():
    automation_file = env("AUTOMATION_FILE", "dcc-ex/myAutomation.h")
    config_file = env("CONFIG_FILE", "dcc-ex/config.csb1.h")
    return {
        "schemaVersion": STATUS_SCHEMA_VERSION,
        "source": "ota-updater",
        "modelRepo": {
            "url": env("MODEL_REPO_URL", MODEL_REPO_URL),
            "ref": env("MODEL_REPO_BRANCH", "main"),
            "branch": None,
            "commit": None,
        },
        "commandStation": {
            "url": env("COMMANDSTATION_REPO_URL", COMMANDSTATION_REPO_URL),
            "ref": env("COMMANDSTATION_REF", "v5.6.0-Prod"),
            "branch": None,
            "commit": None,
        },
        "automation": {
            "file": automation_file,
            "configFile": config_file,
            "trackedHash": None,
            "version": None,
        },
        "flash": {
            "previousHash": None,
            "currentHash": None,
            "forceFlash": bool_env("FORCE_FLASH", False),
            "autoFlash": bool_env("AUTO_FLASH", True),
            "attempted": False,
            "target": {
                "devicePort": os.environ.get("DEVICE_PORT", "/dev/ttyUSB0"),
                "dccExHost": os.environ.get("DCCEX_HOST") or None,
                "dccExPort": int(env("DCCEX_PORT", "2560")),
            },
        },
    }


def build_status_payload(
    context,
    decision,
    generated_at=None,
    flashed_at=None,
    baseline_recorded_at=None,
    sensor_setup=None,
    error=None,
):
    generated_at = generated_at or now_iso()
    normalized_sensor_setup = normalize_sensor_setup(sensor_setup)
    state = status_state(decision, normalized_sensor_setup)
    payload = {
        "schemaVersion": STATUS_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "status": state,
        "source": context.get("source", "ota-updater"),
        "modelRepo": dict(context.get("modelRepo") or {}),
        "commandStation": dict(context.get("commandStation") or {}),
        "automation": dict(context.get("automation") or {}),
        "flash": {
            **dict(context.get("flash") or {}),
            "decision": decision,
            "flashedAt": flashed_at,
            "baselineRecordedAt": baseline_recorded_at,
        },
        "sensorSetup": normalized_sensor_setup,
        "error": sanitize_error(error) if error else None,
    }
    return payload


def status_state(decision, sensor_setup):
    if decision == "failure":
        return "failed"
    if decision == "auto-flash-disabled" or sensor_setup.get("result") == "failure":
        return "warning"
    return "current"


def normalize_sensor_setup(sensor_setup):
    if not sensor_setup:
        return {
            "attempted": False,
            "result": "not-run",
            "skippedReason": None,
            "error": None,
        }
    return {
        "attempted": bool(sensor_setup.get("attempted")),
        "result": sensor_setup.get("result") or "unknown",
        "skippedReason": sensor_setup.get("skippedReason"),
        "error": sanitize_error(sensor_setup.get("error")) if sensor_setup.get("error") else None,
    }


def record_status(path, payload):
    try:
        write_status_artifact(path, payload)
    except OSError as error:
        log(f"unable to write firmware status artifact: {error}")


def write_status_artifact(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.tmp")
    temp_path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf-8")
    temp_path.replace(path)


def git_metadata(path):
    return {
        "branch": git_output(path, ["symbolic-ref", "--short", "-q", "HEAD"]) or None,
        "commit": git_output(path, ["rev-parse", "HEAD"]) or None,
    }


def git_output(path, args):
    process = subprocess.run(
        ["git", "-C", str(path), *args],
        text=True,
        capture_output=True,
    )
    if process.returncode != 0:
        return ""
    return process.stdout.strip()


def parse_automation_version(path):
    try:
        match = AUTOMATION_VERSION_RE.search(path.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return None
    return match.group(0) if match else None


def sanitize_error(error):
    text = " ".join(str(error).split())
    for name, value in os.environ.items():
        if not value:
            continue
        if any(marker in name.upper() for marker in SENSITIVE_ENV_MARKERS):
            text = text.replace(value, "[redacted]")
    if len(text) > MAX_ERROR_LENGTH:
        return f"{text[:MAX_ERROR_LENGTH - 3]}..."
    return text


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sync_repo(path, url, ref):
    if path.exists():
        run(["git", "-C", str(path), "fetch", "--all", "--tags", "--prune"])
    else:
        run(["git", "clone", url, str(path)])
    run(["git", "-C", str(path), "checkout", ref])
    current_branch = subprocess.run(
        ["git", "-C", str(path), "symbolic-ref", "--short", "-q", "HEAD"],
        text=True,
        capture_output=True,
    ).stdout.strip()
    if current_branch:
        run(["git", "-C", str(path), "pull", "--ff-only"], check=False)


def prepare_commandstation_tree(cs_repo, automation_src, config_src):
    shutil.copy2(automation_src, cs_repo / "myAutomation.h")
    config_dst = cs_repo / "config.h"
    shutil.copy2(config_src, config_dst)
    inject_wifi_config(config_dst)
    log(f"copied {automation_src.name} and {config_src.name} into CommandStation-EX")


def inject_wifi_config(config_path):
    ssid = os.environ.get("CSB1_WIFI_SSID")
    password = os.environ.get("CSB1_WIFI_PASSWORD")
    if not ssid or not password:
        return
    with config_path.open("a", encoding="utf-8") as config:
        config.write("\n// Injected by ota-updater from Kubernetes Secret; do not commit secrets.\n")
        config.write(f"#undef WIFI_SSID\n#define WIFI_SSID \"{c_string(ssid)}\"\n")
        config.write(f"#undef WIFI_PASSWORD\n#define WIFI_PASSWORD \"{c_string(password)}\"\n")
    log("injected CSB1 WiFi credentials from environment")


def c_string(value):
    return value.replace("\\", "\\\\").replace('"', '\\"')


def ensure_toolchain():
    arduino_cli = env("ARDUINO_CLI", "arduino-cli")
    run([arduino_cli, "config", "init", "--overwrite", "--additional-urls", ESP32_INDEX_URL])
    run([arduino_cli, "core", "update-index"])
    run([arduino_cli, "core", "install", ESP32_CORE])
    run([arduino_cli, "lib", "install", ETHERNET_LIBRARY], check=False)


def compile_firmware(cs_repo):
    run([
        env("ARDUINO_CLI", "arduino-cli"),
        "compile",
        "-b",
        env("FQBN", "esp32:esp32:esp32"),
        str(cs_repo),
        "--format",
        "jsonmini",
    ])


def upload_firmware(cs_repo):
    port = env("DEVICE_PORT", "/dev/ttyUSB0")
    if not Path(port).exists():
        raise FileNotFoundError(f"USB device does not exist inside container: {port}")
    run([
        env("ARDUINO_CLI", "arduino-cli"),
        "upload",
        "-v",
        "-t",
        "-b",
        env("FQBN", "esp32:esp32:esp32"),
        "-p",
        port,
        str(cs_repo),
        "--format",
        "jsonmini",
        "--board-options",
        "UploadSpeed=115200",
    ])


def pre_flash_shutdown():
    if not bool_env("PRE_FLASH_POWER_OFF", True):
        return
    send_dccex_commands(["</KILL ALL>", "<!>", "<0>"], label="pre-flash shutdown")


def post_flash_sensor_setup():
    if not bool_env("POST_FLASH_SENSOR_SETUP", True):
        return {
            "attempted": False,
            "result": "skipped",
            "skippedReason": "POST_FLASH_SENSOR_SETUP=false",
        }
    time.sleep(int(env("POST_FLASH_WAIT_SECONDS", "20")))
    return send_dccex_commands(["<S 1001 33 0>", "<S 1002 26 0>", "<s>"], label="post-flash sensor setup")


def send_dccex_commands(commands, label):
    host = env("DCCEX_HOST", "")
    port = int(env("DCCEX_PORT", "2560"))
    if not host:
        log(f"{label}: DCCEX_HOST not set; skipping network commands")
        return {
            "attempted": False,
            "result": "skipped",
            "skippedReason": "DCCEX_HOST not set",
        }
    try:
        with socket.create_connection((host, port), timeout=5) as sock:
            sock.settimeout(1)
            for command in commands:
                log(f"{label}: {command}")
                sock.sendall(command.encode("ascii"))
                time.sleep(0.25)
        return {
            "attempted": True,
            "result": "success",
            "skippedReason": None,
            "error": None,
        }
    except OSError as error:
        log(f"{label}: unable to contact {host}:{port}: {error}")
        return {
            "attempted": True,
            "result": "failure",
            "skippedReason": None,
            "error": sanitize_error(error),
        }


def hash_files(paths):
    digest = hashlib.sha256()
    for path in paths:
        digest.update(str(path.name).encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def acquire_lock(path):
    global LOCK_FD
    if fcntl is None:
        path.write_text(f"{os.getpid()}\n", encoding="ascii")
        return True
    try:
        fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o644)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.ftruncate(fd, 0)
        os.write(fd, f"{os.getpid()}\n".encode("ascii"))
        LOCK_FD = fd
        return True
    except BlockingIOError:
        os.close(fd)
        return False


def release_lock(path):
    global LOCK_FD
    if LOCK_FD is not None and fcntl is not None:
        fcntl.flock(LOCK_FD, fcntl.LOCK_UN)
        os.close(LOCK_FD)
        LOCK_FD = None
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def run(command, check=True):
    log("+ " + " ".join(command))
    process = subprocess.run(command, text=True)
    if check and process.returncode != 0:
        raise RuntimeError(f"command failed with exit code {process.returncode}: {' '.join(command)}")
    return process.returncode


def env(name, default=None):
    value = os.environ.get(name, default)
    if value is None:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def bool_env(name, default):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def log(message):
    print(time.strftime("%Y-%m-%dT%H:%M:%S%z"), message, flush=True)


if __name__ == "__main__":
    sys.exit(main())
