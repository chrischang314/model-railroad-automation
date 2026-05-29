import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path


UPDATER_PATH = Path(__file__).resolve().parents[1] / "updater.py"
SPEC = importlib.util.spec_from_file_location("updater", UPDATER_PATH)
updater = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(updater)


class StatusArtifactTests(unittest.TestCase):
    def test_baseline_status_writes_bounded_json(self):
        payload = updater.build_status_payload(
            context(),
            decision="baseline-recorded",
            generated_at="2026-05-29T12:00:00Z",
            baseline_recorded_at="2026-05-29T12:00:00Z",
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            status_path = Path(temp_dir) / "firmware-status.json"
            updater.write_status_artifact(status_path, payload)
            written = json.loads(status_path.read_text(encoding="utf-8"))

        self.assertEqual(written["status"], "current")
        self.assertEqual(written["flash"]["decision"], "baseline-recorded")
        self.assertEqual(written["flash"]["currentHash"], "abc123")
        self.assertEqual(written["automation"]["version"], "v3.18.0")

    def test_no_change_and_success_decisions_are_current(self):
        no_change = updater.build_status_payload(context(), decision="unchanged-no-flash")
        success = updater.build_status_payload(
            context(),
            decision="success",
            flashed_at="2026-05-29T12:05:00Z",
            sensor_setup={"attempted": True, "result": "success"},
        )

        self.assertEqual(no_change["status"], "current")
        self.assertEqual(no_change["flash"]["decision"], "unchanged-no-flash")
        self.assertEqual(success["status"], "current")
        self.assertEqual(success["flash"]["flashedAt"], "2026-05-29T12:05:00Z")
        self.assertEqual(success["sensorSetup"]["result"], "success")

    def test_auto_flash_disabled_and_sensor_failure_warn(self):
        skipped = updater.build_status_payload(context(auto_flash=False), decision="auto-flash-disabled")
        sensor_failure = updater.build_status_payload(
            context(),
            decision="success",
            sensor_setup={"attempted": True, "result": "failure", "error": "DCCEX_HOST timeout"},
        )

        self.assertEqual(skipped["status"], "warning")
        self.assertFalse(skipped["flash"]["autoFlash"])
        self.assertEqual(sensor_failure["status"], "warning")
        self.assertEqual(sensor_failure["sensorSetup"]["result"], "failure")
        self.assertIn("timeout", sensor_failure["sensorSetup"]["error"])

    def test_sensor_setup_skip_is_captured(self):
        payload = updater.build_status_payload(
            context(),
            decision="success",
            sensor_setup={
                "attempted": False,
                "result": "skipped",
                "skippedReason": "POST_FLASH_SENSOR_SETUP=false",
            },
        )

        self.assertEqual(payload["sensorSetup"]["result"], "skipped")
        self.assertEqual(payload["sensorSetup"]["skippedReason"], "POST_FLASH_SENSOR_SETUP=false")

    def test_failure_payload_redacts_secret_values(self):
        old_password = os.environ.get("CSB1_WIFI_PASSWORD")
        old_token = os.environ.get("CONTROL_TOKEN")
        os.environ["CSB1_WIFI_PASSWORD"] = "super-secret-password"
        os.environ["CONTROL_TOKEN"] = "secret-token"
        try:
            payload = updater.build_status_payload(
                context(),
                decision="failure",
                error="compile failed with super-secret-password and secret-token",
            )
        finally:
            restore_env("CSB1_WIFI_PASSWORD", old_password)
            restore_env("CONTROL_TOKEN", old_token)

        encoded = json.dumps(payload)
        self.assertEqual(payload["status"], "failed")
        self.assertNotIn("super-secret-password", encoded)
        self.assertNotIn("secret-token", encoded)
        self.assertIn("[redacted]", payload["error"])

    def test_automation_version_parses_header_label(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            header = Path(temp_dir) / "myAutomation.h"
            header.write_text("// myAutomation.h - test (v9.8.7)\n", encoding="utf-8")
            self.assertEqual(updater.parse_automation_version(header), "v9.8.7")


def context(auto_flash=True):
    return {
        "source": "ota-updater",
        "modelRepo": {
            "url": "https://example/model.git",
            "ref": "main",
            "branch": "main",
            "commit": "model-commit",
        },
        "commandStation": {
            "url": "https://example/dccex.git",
            "ref": "v5.6.0-Prod",
            "branch": None,
            "commit": "dcc-commit",
        },
        "automation": {
            "file": "dcc-ex/myAutomation.h",
            "configFile": "dcc-ex/config.csb1.h",
            "trackedHash": "abc123",
            "version": "v3.18.0",
        },
        "flash": {
            "previousHash": "old456",
            "currentHash": "abc123",
            "forceFlash": False,
            "autoFlash": auto_flash,
            "attempted": False,
            "target": {
                "devicePort": "/dev/csb1",
                "dccExHost": "192.168.4.22",
                "dccExPort": 2560,
            },
        },
    }


def restore_env(name, value):
    if value is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = value


if __name__ == "__main__":
    unittest.main()
