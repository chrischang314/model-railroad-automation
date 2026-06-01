# Model Railroad Web-Control Handoff

Last updated: 2026-05-29
Current branch: `main`

## Current Change

This change adds read-only flash provenance visibility. It does not change
EXRAIL, train commands, turnout commands, power commands, CV writes, or raw
command behavior.

- `ota-updater/firmware_status.py` writes a bounded
  `/state/firmware-status.json` artifact after baseline, no-change, skipped,
  success, warning, or failed updater runs.
- `ota-updater/updater.py` records the tracked hash for `myAutomation.h` plus
  `config.csb1.h`, model and CommandStation refs/commits, parsed automation
  version, target device/host, flash decision, flash or baseline time, sensor
  setup result, and redacted short errors.
- `web-control/src/firmware-status.js` exposes a safe public
  `GET /api/firmware-status` endpoint. Missing, malformed, stale, or failed
  status files return HTTP 200 warning payloads.
- The Control page shows a Firmware panel with live DCC-EX version, expected
  automation version/hash, last proof time, updater decision, and sensor setup
  result. Loading or refreshing this panel sends only a GET request.
- A container-orchestrator companion branch mounts
  `/var/lib/csb1-ota-updater/state` into web-control at `/state` and sets
  `FIRMWARE_STATUS_FILE=/state/firmware-status.json`.

The existing All Stop behavior remains unchanged. It calls
`POST /api/trains/stop-all`, which sends `<t cab 0 direction>` for every train
listed in `web-control/src/layout.js` while preserving each current direction
bit.

This is intentionally different from Emergency Stop. All Stop stops configured
locomotives through throttle commands while leaving EXRAIL running; Emergency
Stop still sends `</KILL ALL>` and `<!>`.

## Verification

Run the focused tests from `web-control/`:

```powershell
& "C:\Program Files\cursor\resources\app\resources\helpers\node.exe" --test
```

Run the updater status tests from the repo root:

```powershell
python -m py_compile ota-updater\firmware_status.py ota-updater\updater.py ota-updater\test_firmware_status.py
python -m unittest ota-updater\test_firmware_status.py
```

For browser verification, run mock mode and open the control and programming
pages:

```powershell
$env:DCCEX_MOCK = "true"
$env:PORT = "3000"
& "C:\Program Files\cursor\resources\app\resources\helpers\node.exe" src/server.js
```

Confirm `/health` includes `telemetry`, `movingTrains`, and `activeSensors`.
On the pages, confirm the header includes `telemetry mock` in mock mode. To
exercise stale styling locally, run without mock against an unreachable host and
confirm the header shows a connection error; against real hardware, wait longer
than `TELEMETRY_STALE_MS` after the last command-station message to see the
amber stale state.
For firmware UI verification, point `FIRMWARE_STATUS_FILE` at a fixture JSON
file and confirm the Control page renders current, missing, malformed, and
stale states. Fetching `/api/firmware-status` and refreshing the Firmware panel
must not add DCC-EX transmit messages to `/api/state`.

## Deployment Notes

The Kubernetes app is defined in
`C:\Users\chris\Projects\container-orchestrator\apps\model-railroad-automation\values.yaml`
and currently tracks the `main` image tag.

After publishing `main`, wait for the GHCR `web-control:main` image, then
deploy with:

```powershell
& "C:\Users\chris\.codex\tools\helm-v4.2.0\helm.exe" lint charts\app -f apps\model-railroad-automation\values.yaml
& "C:\Users\chris\.codex\tools\helm-v4.2.0\helm.exe" upgrade --install model-railroad-automation charts/app -f apps/model-railroad-automation/values.yaml --namespace default --create-namespace --wait --timeout 5m
kubectl rollout restart deployment/model-railroad-automation-web-control -n default
kubectl rollout status deployment/model-railroad-automation-web-control -n default --timeout=180s
```

The live LAN page at `http://modelrailroadautomation.lan/` includes the All Stop
button, and `POST /api/trains/stop-all` was smoke-tested while the railroad was
idle.

After deploy, verify:

- `http://modelrailroadautomation.lan/api/firmware-status` returns HTTP 200.
- The Control page renders the Firmware panel.
- Loading and refreshing firmware status sends no train, turnout, power, CV,
  raw command, or flash action.

Rollback is a normal revert of the updater status writer, web-control endpoint,
UI panel, and container-orchestrator status-path mount. Leave
`last-flashed.sha256` untouched.
