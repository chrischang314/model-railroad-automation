#!/usr/bin/env python3
import argparse
import fcntl
import hashlib
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path


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

    sync_repo(model_repo, env("MODEL_REPO_URL", MODEL_REPO_URL), env("MODEL_REPO_BRANCH", "main"))
    sync_repo(cs_repo, env("COMMANDSTATION_REPO_URL", COMMANDSTATION_REPO_URL), env("COMMANDSTATION_REF", "v5.6.0-Prod"))

    automation_src = model_repo / env("AUTOMATION_FILE", "dcc-ex/myAutomation.h")
    config_src = model_repo / env("CONFIG_FILE", "dcc-ex/config.csb1.h")
    if not automation_src.exists():
        raise FileNotFoundError(f"automation file not found: {automation_src}")
    if not config_src.exists():
        raise FileNotFoundError(f"config file not found: {config_src}")

    tracked_hash = hash_files([automation_src, config_src])
    previous_hash = previous_hash_path.read_text(encoding="utf-8").strip() if previous_hash_path.exists() else ""
    force_flash = bool_env("FORCE_FLASH", False)

    if not previous_hash and not bool_env("FLASH_ON_FIRST_RUN", False) and not force_flash:
        previous_hash_path.write_text(tracked_hash, encoding="utf-8")
        log(f"first run baseline recorded ({tracked_hash}); no flash performed")
        return 0

    if tracked_hash == previous_hash and not force_flash:
        log(f"no change detected ({tracked_hash})")
        return 0

    log(f"change detected: {previous_hash or '<none>'} -> {tracked_hash}")
    if not bool_env("AUTO_FLASH", True):
        log("AUTO_FLASH=false; build/upload skipped")
        return 0

    prepare_commandstation_tree(cs_repo, automation_src, config_src)
    ensure_toolchain()
    compile_firmware(cs_repo)
    pre_flash_shutdown()
    upload_firmware(cs_repo)
    previous_hash_path.write_text(tracked_hash, encoding="utf-8")
    post_flash_sensor_setup()
    log(f"flash complete ({tracked_hash})")
    return 0


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
    shutil.copy2(config_src, cs_repo / "config.h")
    log(f"copied {automation_src.name} and {config_src.name} into CommandStation-EX")


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
        return
    time.sleep(int(env("POST_FLASH_WAIT_SECONDS", "20")))
    send_dccex_commands(["<S 1001 33 0>", "<S 1002 26 0>", "<s>"], label="post-flash sensor setup")


def send_dccex_commands(commands, label):
    host = env("DCCEX_HOST", "")
    port = int(env("DCCEX_PORT", "2560"))
    if not host:
        log(f"{label}: DCCEX_HOST not set; skipping network commands")
        return
    try:
        with socket.create_connection((host, port), timeout=5) as sock:
            sock.settimeout(1)
            for command in commands:
                log(f"{label}: {command}")
                sock.sendall(command.encode("ascii"))
                time.sleep(0.25)
    except OSError as error:
        log(f"{label}: unable to contact {host}:{port}: {error}")


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
