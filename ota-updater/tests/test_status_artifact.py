import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


FIRMWARE_STATUS_PATH = Path(__file__).resolve().parents[1] / "firmware_status.py"
SPEC = importlib.util.spec_from_file_location("firmware_status", FIRMWARE_STATUS_PATH)
firmware_status = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(firmware_status)


class StatusArtifactTests(unittest.TestCase):
    def test_baseline_status_writes_bounded_json(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = status_fixture(temp_dir)
            payload = firmware_status.build_status_payload(
                decision="baseline_recorded",
                status="warning",
                message="First run baseline recorded; no flash performed.",
                automation_file=fixture["automation"],
                config_file=fixture["config"],
                tracked_hash="abc123",
                previous_hash="",
                model_repo=fixture["model_repo"],
                model_ref="main",
                model_repo_url="https://example/model.git",
                commandstation_repo=fixture["commandstation_repo"],
                commandstation_ref="v5.6.0-Prod",
                commandstation_repo_url="https://example/dccex.git",
                target=target(),
                sensor_setup=sensor_setup("skipped", attempted=False, reason="first run baseline"),
                recorded_at="2026-05-29T12:00:00Z",
                baseline_at="2026-05-29T12:00:00Z",
            )
            status_path = Path(temp_dir) / "firmware-status.json"
            firmware_status.write_status(status_path, payload)
            written = json.loads(status_path.read_text(encoding="utf-8"))

        self.assertEqual(written["status"], "warning")
        self.assertEqual(written["decision"], "baseline_recorded")
        self.assertEqual(written["trackedHash"], "abc123")
        self.assertEqual(written["automation"]["version"], "v3.18.0")
        self.assertEqual(written["baselineAt"], "2026-05-29T12:00:00Z")

    def test_no_change_and_success_decisions_are_current(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = status_fixture(temp_dir)
            no_change = build_payload(fixture, decision="unchanged_no_flash", status="current")
            success = build_payload(
                fixture,
                decision="success",
                status="current",
                flashed_at="2026-05-29T12:05:00Z",
                sensor_setup_payload=sensor_setup("success", attempted=True, command_count=3),
            )

        self.assertEqual(no_change["status"], "current")
        self.assertEqual(no_change["decision"], "unchanged_no_flash")
        self.assertEqual(success["status"], "current")
        self.assertEqual(success["flashedAt"], "2026-05-29T12:05:00Z")
        self.assertEqual(success["postFlashSensorSetup"]["status"], "success")

    def test_auto_flash_disabled_and_sensor_failure_warn(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = status_fixture(temp_dir)
            skipped = build_payload(
                fixture,
                decision="skipped_auto_flash_false",
                status="warning",
                sensor_setup_payload=sensor_setup("skipped", attempted=False, reason="AUTO_FLASH=false"),
            )
            sensor_failure = build_payload(
                fixture,
                decision="success",
                status="warning",
                sensor_setup_payload=sensor_setup("failure", attempted=True, error="DCCEX_HOST timeout"),
            )

        self.assertEqual(skipped["status"], "warning")
        self.assertEqual(skipped["postFlashSensorSetup"]["reason"], "AUTO_FLASH=false")
        self.assertEqual(sensor_failure["status"], "warning")
        self.assertEqual(sensor_failure["postFlashSensorSetup"]["status"], "failure")
        self.assertIn("timeout", sensor_failure["postFlashSensorSetup"]["error"])

    def test_failure_payload_redacts_secret_values(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = status_fixture(temp_dir)
            with patch.dict(os.environ, {
                "CSB1_WIFI_PASSWORD": "super-secret-password",
                "CONTROL_TOKEN": "secret-token",
            }, clear=False):
                payload = build_payload(
                    fixture,
                    decision="failure",
                    status="error",
                    error="compile failed with super-secret-password and secret-token",
                )

        encoded = json.dumps(payload)
        self.assertEqual(payload["status"], "error")
        self.assertNotIn("super-secret-password", encoded)
        self.assertNotIn("secret-token", encoded)
        self.assertIn("[redacted]", payload["error"])

    def test_automation_version_parses_header_label(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            header = Path(temp_dir) / "myAutomation.h"
            header.write_text("// myAutomation.h - test (v9.8.7)\n", encoding="utf-8")
            self.assertEqual(firmware_status.parse_automation_version(header), "v9.8.7")


def build_payload(fixture, **overrides):
    return firmware_status.build_status_payload(
        decision=overrides.get("decision", "success"),
        status=overrides.get("status", "current"),
        message=overrides.get("message", "Status updated."),
        automation_file=fixture["automation"],
        config_file=fixture["config"],
        tracked_hash="abc123",
        previous_hash="old456",
        model_repo=fixture["model_repo"],
        model_ref="main",
        model_repo_url="https://example/model.git",
        commandstation_repo=fixture["commandstation_repo"],
        commandstation_ref="v5.6.0-Prod",
        commandstation_repo_url="https://example/dccex.git",
        target=target(),
        sensor_setup=overrides.get("sensor_setup_payload", sensor_setup("skipped", attempted=False)),
        error=overrides.get("error"),
        recorded_at="2026-05-29T12:00:00Z",
        flashed_at=overrides.get("flashed_at"),
    )


def status_fixture(temp_dir):
    root = Path(temp_dir)
    model_repo = root / "model"
    commandstation_repo = root / "commandstation"
    model_repo.mkdir()
    commandstation_repo.mkdir()
    automation = model_repo / "myAutomation.h"
    config = model_repo / "config.csb1.h"
    automation.write_text("// myAutomation.h - Shuttle (v3.18.0)\n", encoding="utf-8")
    config.write_text("#define WIFI\n", encoding="utf-8")
    return {
        "model_repo": model_repo,
        "commandstation_repo": commandstation_repo,
        "automation": automation,
        "config": config,
    }


def sensor_setup(status, *, attempted, reason=None, error=None, command_count=0):
    return {
        "attempted": attempted,
        "status": status,
        "reason": reason,
        "error": firmware_status.sanitize_error(error) if error else None,
        "commandCount": command_count,
    }


def target():
    return {
        "devicePort": "/dev/csb1",
        "dccExHost": "192.168.4.22",
        "dccExPort": 2560,
    }


if __name__ == "__main__":
    unittest.main()
