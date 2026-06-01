import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import updater  # noqa: E402
from firmware_status import parse_automation_version, write_status  # noqa: E402


class FirmwareStatusTests(unittest.TestCase):
    def test_parse_automation_version_from_header(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            automation = Path(temp_dir) / "myAutomation.h"
            automation.write_text("// myAutomation.h - Shuttle (v3.18.0)\n", encoding="utf-8")
            self.assertEqual(parse_automation_version(automation), "v3.18.0")

    def test_first_run_records_baseline_status(self):
        with updater_fixture() as fixture:
            result = run_fixture_once(fixture)
            self.assertEqual(result, 0)
            status = fixture.status()
            self.assertEqual(status["decision"], "baseline_recorded")
            self.assertEqual(status["status"], "warning")
            self.assertEqual(status["baselineAt"], status["recordedAt"])
            self.assertEqual(status["automation"]["version"], "v3.18.0")
            self.assertTrue(fixture.last_hash_path.exists())

    def test_no_change_writes_current_no_flash_status(self):
        with updater_fixture() as fixture:
            fixture.last_hash_path.write_text(fixture.tracked_hash(), encoding="utf-8")
            result = run_fixture_once(fixture)
            self.assertEqual(result, 0)
            status = fixture.status()
            self.assertEqual(status["decision"], "unchanged_no_flash")
            self.assertEqual(status["status"], "current")
            self.assertEqual(status["trackedHash"], fixture.tracked_hash())

    def test_successful_flash_writes_flash_and_sensor_status(self):
        with updater_fixture() as fixture:
            fixture.last_hash_path.write_text("old-hash", encoding="utf-8")
            sensor_result = updater.sensor_setup_result("success", attempted=True, command_count=3)
            result = run_fixture_once(fixture, sensor_setup=sensor_result)
            self.assertEqual(result, 0)
            status = fixture.status()
            self.assertEqual(status["decision"], "success")
            self.assertEqual(status["status"], "current")
            self.assertEqual(status["flashedAt"], status["recordedAt"])
            self.assertEqual(status["postFlashSensorSetup"]["status"], "success")

    def test_auto_flash_false_writes_skipped_status(self):
        with updater_fixture(extra_env={"AUTO_FLASH": "false"}) as fixture:
            fixture.last_hash_path.write_text("old-hash", encoding="utf-8")
            result = run_fixture_once(fixture)
            self.assertEqual(result, 0)
            status = fixture.status()
            self.assertEqual(status["decision"], "skipped_auto_flash_false")
            self.assertEqual(status["status"], "warning")
            self.assertEqual(fixture.last_hash_path.read_text(encoding="utf-8"), "old-hash")

    def test_sensor_setup_failure_is_captured_without_failing_flash(self):
        with updater_fixture() as fixture:
            fixture.last_hash_path.write_text("old-hash", encoding="utf-8")
            sensor_result = updater.sensor_setup_result("failure", attempted=True, error="network unavailable", command_count=3)
            result = run_fixture_once(fixture, sensor_setup=sensor_result)
            self.assertEqual(result, 0)
            status = fixture.status()
            self.assertEqual(status["decision"], "success")
            self.assertEqual(status["status"], "warning")
            self.assertEqual(status["postFlashSensorSetup"]["error"], "network unavailable")

    def test_failure_status_redacts_secret_values(self):
        with updater_fixture(extra_env={"CSB1_WIFI_PASSWORD": "fixture-sensitive-value"}) as fixture:
            fixture.last_hash_path.write_text("old-hash", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                run_fixture_once(fixture, compile_error=RuntimeError("failed with fixture-sensitive-value"))
            status = fixture.status()
            self.assertEqual(status["decision"], "failure")
            self.assertEqual(status["status"], "error")
            self.assertNotIn("fixture-sensitive-value", json.dumps(status))
            self.assertIn("[redacted]", status["error"])

    def test_write_status_is_bounded_json(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "status.json"
            write_status(path, {"decision": "success", "logs": "not included"})
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["decision"], "success")


class updater_fixture:
    def __init__(self, extra_env=None):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state_dir = self.root / "state"
        self.work_dir = self.root / "work"
        self.model_repo = self.work_dir / "model-railroad-automation"
        self.cs_repo = self.work_dir / "CommandStation-EX"
        self.status_path = self.state_dir / "firmware-status.json"
        self.last_hash_path = self.state_dir / "last-flashed.sha256"
        self.extra_env = extra_env or {}

    def __enter__(self):
        self.state_dir.mkdir(parents=True)
        (self.model_repo / "dcc-ex").mkdir(parents=True)
        self.cs_repo.mkdir(parents=True)
        (self.model_repo / "dcc-ex" / "myAutomation.h").write_text(
            "// myAutomation.h - Shuttle (v3.18.0)\nROUTE(100)\n",
            encoding="utf-8",
        )
        (self.model_repo / "dcc-ex" / "config.csb1.h").write_text("#define WIFI\n", encoding="utf-8")
        return self

    def __exit__(self, exc_type, exc, tb):
        self.temp.cleanup()

    def env(self):
        return {
            "FIRMWARE_STATUS_FILE": str(self.status_path),
            "DEVICE_PORT": "/dev/csb1",
            "DCCEX_HOST": "192.168.4.22",
            "DCCEX_PORT": "2560",
            "POST_FLASH_WAIT_SECONDS": "0",
            **self.extra_env,
        }

    def tracked_hash(self):
        return updater.hash_files([
            self.model_repo / "dcc-ex" / "myAutomation.h",
            self.model_repo / "dcc-ex" / "config.csb1.h",
        ])

    def status(self):
        return json.loads(self.status_path.read_text(encoding="utf-8"))


def run_fixture_once(fixture, *, sensor_setup=None, compile_error=None):
    sensor_setup = sensor_setup or updater.sensor_setup_result("skipped", attempted=False)
    compile_effect = compile_error if compile_error else None
    with patch.dict(os.environ, fixture.env(), clear=False):
        with patch.object(updater, "sync_repo", return_value=None):
            with patch.object(updater, "prepare_commandstation_tree", return_value=None):
                with patch.object(updater, "ensure_toolchain", return_value=None):
                    with patch.object(updater, "compile_firmware", side_effect=compile_effect, return_value=None):
                        with patch.object(updater, "pre_flash_shutdown", return_value=updater.sensor_setup_result("skipped", attempted=False)):
                            with patch.object(updater, "upload_firmware", return_value=None):
                                with patch.object(updater, "post_flash_sensor_setup", return_value=sensor_setup):
                                    return updater.run_once(fixture.state_dir, fixture.work_dir)


if __name__ == "__main__":
    unittest.main()
