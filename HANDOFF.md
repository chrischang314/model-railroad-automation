# Model Railroad Web-Control Handoff

Last updated: 2026-05-29
Current branch: `projects-lan-implementer-c-2026-05-29-railroad-flash-provenance`

## Current Change

Implementer C added read-only flash provenance visibility.

- `ota-updater/updater.py` now writes a bounded `firmware-status.json` artifact
  after baseline, no-change, `AUTO_FLASH=false`, successful flash, and failure
  outcomes.
- `web-control` exposes `GET /api/firmware-status` without requiring
  `CONTROL_TOKEN`.
- The Control page renders a compact Firmware panel with live DCC-EX version,
  expected automation version/hash, latest proof time, flash decision, and
  post-flash sensor setup result.

The status path is configurable with `FIRMWARE_STATUS_FILE`. Web-control warns
instead of returning 500 when the file is missing, stale, malformed, failed, or
unavailable.

## Verification

Completed in this worktree:

```powershell
& "C:\Program Files\cursor\resources\app\resources\helpers\node.exe" --test
python -m unittest discover -s ota-updater\tests
```

Both passed on 2026-05-29. A Playwright mock-mode browser smoke also loaded the
Control page, verified the Firmware panel rendered `v3.18.0` and the shortened
hash, clicked the panel refresh button, and confirmed the command log did not
gain TX entries.

To repeat the browser verification, run mock mode with a fixture status file:

```powershell
$env:DCCEX_MOCK = "true"
$env:FIRMWARE_STATUS_FILE = "<path-to-fixture>\firmware-status.json"
$env:PORT = "3000"
& "C:\Program Files\cursor\resources\app\resources\helpers\node.exe" web-control\src\server.js
```

Open `http://127.0.0.1:3000/` and confirm the Firmware panel renders without
creating command-log transmit entries.

## Deployment Notes

This implementer branch is judge-ready only. It was not merged, pushed,
published, or deployed by the implementer role.

Live deployment needs the web-control pod to see the same status artifact path
that the updater writes. The updater default and manifest path are
`/state/firmware-status.json`; set web-control `FIRMWARE_STATUS_FILE` to the
mounted shared path in `container-orchestrator` if the judge selects this
implementation. Do not store WiFi credentials, control tokens, kube tokens, or
raw updater logs in the artifact.

Rollback is a source revert plus removing the web-control
`FIRMWARE_STATUS_FILE` mount/env if deployed. Leave `last-flashed.sha256`
untouched unless the flash baseline intentionally needs to reset.
