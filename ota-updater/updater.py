#!/usr/bin/env python3
import argparse
import hashlib
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

try:
    import fcntl
except ImportError:
    fcntl = None

from firmware_status import (
    build_status_payload,
    read_existing_status,
    sanitize_error,
    utc_now,
    write_status,
)


ESP32_INDEX_URL = "https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json"
ESP32_CORE = "esp32:esp32@2.0.17"
ETHERNET_LIBRARY = "Ethernet@2.0.2"
MODEL_REPO_URL = "https://github.com/chrischang314/model-railroad-automation.git"
COMMANDSTATION_REPO_URL = "https://github.com/DCC-EX/CommandStation-EX.git"
LOCK_FD = None


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
    status_path = Path(env("FIRMWARE_STATUS_FILE", str(state_dir / "firmware-status.json")))
    model_repo_url = env("MODEL_REPO_URL", MODEL_REPO_URL)
    model_ref = env("MODEL_REPO_BRANCH", "main")
    commandstation_repo_url = env("COMMANDSTATION_REPO_URL", COMMANDSTATION_REPO_URL)
    commandstation_ref = env("COMMANDSTATION_REF", "v5.6.0-Prod")
    automation_rel = env("AUTOMATION_FILE", "dcc-ex/myAutomation.h")
    config_rel = env("CONFIG_FILE", "dcc-ex/config.csb1.h")
    target = flash_target()
    previous_status = read_existing_status(status_path)

    automation_src = model_repo / automation_rel
    config_src = model_repo / config_rel
    tracked_hash = None
    previous_hash = previous_hash_path.read_text(encoding="utf-8").strip() if previous_hash_path.exists() else ""

    try:
        sync_repo(model_repo, model_repo_url, model_ref)
        sync_repo(cs_repo, commandstation_repo_url, commandstation_ref)

        if not automation_src.exists():
            raise FileNotFoundError(f"automation file not found: {automation_src}")
        if not config_src.exists():
            raise FileNotFoundError(f"config file not found: {config_src}")

        tracked_hash = hash_files([automation_src, config_src])
        force_flash = bool_env("FORCE_FLASH", False)

        if not previous_hash and not bool_env("FLASH_ON_FIRST_RUN", False) and not force_flash:
            previous_hash_path.write_text(tracked_hash, encoding="utf-8")
            write_status(status_path, build_status(
                decision="baseline_recorded",
                status="warning",
                message="First run baseline recorded; no flash performed.",
                automation_src=automation_src,
                config_src=config_src,
                tracked_hash=tracked_hash,
                previous_hash=previous_hash,
                model_repo=model_repo,
                model_ref=model_ref,
                model_repo_url=model_repo_url,
                cs_repo=cs_repo,
                commandstation_ref=commandstation_ref,
                commandstation_repo_url=commandstation_repo_url,
                target=target,
                sensor_setup=sensor_setup_result("skipped", attempted=False, reason="first run baseline"),
                existing_status=previous_status,
                baseline_at=utc_now(),
            ))
            log(f"first run baseline recorded ({tracked_hash}); no flash performed")
            return 0

        if tracked_hash == previous_hash and not force_flash:
            write_status(status_path, build_status(
                decision="unchanged_no_flash",
                status="current",
                message="Tracked firmware inputs are unchanged; no flash needed.",
                automation_src=automation_src,
                config_src=config_src,
                tracked_hash=tracked_hash,
                previous_hash=previous_hash,
                model_repo=model_repo,
                model_ref=model_ref,
                model_repo_url=model_repo_url,
                cs_repo=cs_repo,
                commandstation_ref=commandstation_ref,
                commandstation_repo_url=commandstation_repo_url,
                target=target,
                sensor_setup=sensor_setup_result("skipped", attempted=False, reason="no flash needed"),
                existing_status=previous_status,
            ))
            log(f"no change detected ({tracked_hash})")
            return 0

        log(f"change detected: {previous_hash or '<none>'} -> {tracked_hash}")
        if not bool_env("AUTO_FLASH", True):
            write_status(status_path, build_status(
                decision="skipped_auto_flash_false",
                status="warning",
                message="Tracked firmware inputs changed, but AUTO_FLASH=false skipped build and upload.",
                automation_src=automation_src,
                config_src=config_src,
                tracked_hash=tracked_hash,
                previous_hash=previous_hash,
                model_repo=model_repo,
                model_ref=model_ref,
                model_repo_url=model_repo_url,
                cs_repo=cs_repo,
                commandstation_ref=commandstation_ref,
                commandstation_repo_url=commandstation_repo_url,
                target=target,
                sensor_setup=sensor_setup_result("skipped", attempted=False, reason="AUTO_FLASH=false"),
                existing_status=previous_status,
            ))
            log("AUTO_FLASH=false; build/upload skipped")
            return 0

        prepare_commandstation_tree(cs_repo, automation_src, config_src)
        ensure_toolchain()
        compile_firmware(cs_repo)
        pre_flash_shutdown()
        upload_firmware(cs_repo)
        previous_hash_path.write_text(tracked_hash, encoding="utf-8")
        sensor_setup = post_flash_sensor_setup()
        sensor_ok = sensor_setup.get("status") in {"success", "skipped"}
        recorded_at = utc_now()
        write_status(status_path, build_status(
            decision="success",
            status="current" if sensor_ok else "warning",
            message="Flash completed." if sensor_ok else "Flash completed, but post-flash sensor setup reported a warning.",
            automation_src=automation_src,
            config_src=config_src,
            tracked_hash=tracked_hash,
            previous_hash=previous_hash,
            model_repo=model_repo,
            model_ref=model_ref,
            model_repo_url=model_repo_url,
            cs_repo=cs_repo,
            commandstation_ref=commandstation_ref,
            commandstation_repo_url=commandstation_repo_url,
            target=target,
            sensor_setup=sensor_setup,
            existing_status=previous_status,
            recorded_at=recorded_at,
            flashed_at=recorded_at,
        ))
        log(f"flash complete ({tracked_hash})")
        return 0
    except Exception as error:
        if automation_src.exists() and config_src.exists() and not tracked_hash:
            tracked_hash = hash_files([automation_src, config_src])
        write_status(status_path, build_status(
            decision="failure",
            status="error",
            message="Updater run failed before a verified flash completed.",
            automation_src=automation_src,
            config_src=config_src,
            tracked_hash=tracked_hash,
            previous_hash=previous_hash,
            model_repo=model_repo,
            model_ref=model_ref,
            model_repo_url=model_repo_url,
            cs_repo=cs_repo,
            commandstation_ref=commandstation_ref,
            commandstation_repo_url=commandstation_repo_url,
            target=target,
            sensor_setup=sensor_setup_result("skipped", attempted=False, reason="run failed before post-flash setup"),
            existing_status=previous_status,
            error=error,
        ))
        raise


def build_status(**kwargs):
    return build_status_payload(
        automation_file=kwargs.pop("automation_src"),
        config_file=kwargs.pop("config_src"),
        commandstation_repo=kwargs.pop("cs_repo"),
        **kwargs,
    )


def flash_target():
    return {
        "devicePort": env("DEVICE_PORT", "/dev/ttyUSB0"),
        "dccExHost": os.environ.get("DCCEX_HOST") or None,
        "dccExPort": int(env("DCCEX_PORT", "2560")),
    }


def sensor_setup_result(status, *, attempted, reason=None, error=None, command_count=0):
    return {
        "attempted": attempted,
        "status": status,
        "reason": reason,
        "error": sanitize_error(error) if error else None,
        "commandCount": command_count,
    }


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
        return sensor_setup_result("skipped", attempted=False, reason="PRE_FLASH_POWER_OFF=false")
    return send_dccex_commands(["</KILL ALL>", "<!>", "<0>"], label="pre-flash shutdown")


def post_flash_sensor_setup():
    if not bool_env("POST_FLASH_SENSOR_SETUP", True):
        return sensor_setup_result("skipped", attempted=False, reason="POST_FLASH_SENSOR_SETUP=false")
    time.sleep(int(env("POST_FLASH_WAIT_SECONDS", "20")))
    return send_dccex_commands(["<S 1001 33 0>", "<S 1002 26 0>", "<s>"], label="post-flash sensor setup")


def send_dccex_commands(commands, label):
    host = env("DCCEX_HOST", "")
    port = int(env("DCCEX_PORT", "2560"))
    if not host:
        log(f"{label}: DCCEX_HOST not set; skipping network commands")
        return sensor_setup_result("skipped", attempted=False, reason="DCCEX_HOST not set")
    try:
        with socket.create_connection((host, port), timeout=5) as sock:
            sock.settimeout(1)
            for command in commands:
                log(f"{label}: {command}")
                sock.sendall(command.encode("ascii"))
                time.sleep(0.25)
        return sensor_setup_result("success", attempted=True, command_count=len(commands))
    except OSError as error:
        log(f"{label}: unable to contact {host}:{port}: {error}")
        return sensor_setup_result("failure", attempted=True, error=error, command_count=len(commands))


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
    if LOCK_FD is not None:
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
