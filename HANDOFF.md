# Model Railroad Web-Control Handoff

Last updated: 2026-06-06
Current branch: `main`

## Current Change

This handoff covers the current web-control app on `main`: direct LAN/browser
control access plus the Persistent Operating Session Recorder. The recorder is
intentionally observational: it records and exports what happened during a run,
but does not add replay, resend, resume, or new train-control commands. It does
not change EXRAIL or run live movement tests.

Session recorder pieces:

- `web-control/src/session-recorder.js` writes bounded JSONL session files,
  redacts sensitive-looking values, reads malformed/missing files with warnings,
  and prunes by count/age.
- `web-control/src/dcc-client.js` forwards DCC-EX tx/rx log entries to the
  recorder while avoiding double-counting real `send()` writes.
- `web-control/src/server.js` records operator action/result events, explicit
  start/stop/all-stop/emergency-stop events, power/turnout/sensor/automation
  transitions, and telemetry stale/recovered windows. It exposes read-only
  `/api/sessions/latest`, `/api/sessions`, and
  `/api/sessions/:id/export`.
- `web-control/public/index.html`, `app.js`, and `styles.css` add a compact
  Control-page session panel and export link. Refreshing the panel uses GET
  endpoints only and does not send DCC-EX commands.
- `web-control/Dockerfile` and `docker-compose.yml` set `/app/data/sessions`
  and mount `./web-control/data` for local persistence.

Browser command access:

- `web-control/src/server.js` keeps `/health`, `GET /api/state`,
  `GET /api/roster`, `GET /api/events`, and `GET /api/firmware-status` public.
- With real hardware (`DCCEX_MOCK=false`), write/control APIs fail closed unless
  `CONTROL_TOKEN` is configured or `ALLOW_UNAUTHENTICATED_CONTROL=true` is set.
- The current Kubernetes deployment uses `ALLOW_UNAUTHENTICATED_CONTROL=true`,
  so projects.lan SSO, per-user accounts, CSRF tokens, and hardware arm tokens
  are not required. A generic visitor who can reach
  `http://modelrailroadautomation.lan/` or
  `http://projects.lan/railroad-automation/` can send DCC-EX commands directly.
- To require a token again, remove `ALLOW_UNAUTHENTICATED_CONTROL`, configure
  `CONTROL_TOKEN`, and redeploy. The browser will then include the token on
  write/control requests.
- `web-control/public/app.js` and `web-control/public/operations.js` now send
  API requests through the detected direct or proxied base path. Their auth
  panels stay hidden when `/api/config` reports `authRequired: false`.
- The browser scripts derive their API base path from the loaded script URL or
  the `/railroad-automation` page path. Keep this behavior so
  `http://projects.lan/railroad-automation/` sends writes to
  `/railroad-automation/api/...` while direct `modelrailroadautomation.lan`
  access still uses `/api/...`.
- `web-control/Dockerfile` now uses Node 24, and `web-control/package.json`
  requires Node >=22.5 because `node:sqlite` is used.

## Verification

Run the focused tests from `web-control/`:

```powershell
& "C:\Program Files\cursor\resources\app\resources\helpers\node.exe" --test
```

The local `npm.cmd` wrapper was not available in this Codex session, but the
repo's test script is the same `node --test` command. The suite uses mock mode
for physical-command coverage; do not use live movement as an auth regression
test.

For firmware/updater changes, also run the updater status tests from the repo
root:

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

Then click Refresh, Power On, All Stop, a turnout action, and a train stop.
Confirm the status strip changes from sending to a success message, the recent
action history stays bounded, and failures show the red error state.
For the recorder, confirm `GET /api/sessions/latest` returns HTTP 200 with a
session payload, the Control page shows the Session panel, the Export link
returns JSONL, and refreshing/exporting session data does not add new DCC-EX
`tx` events.

## Deployment Notes

The current `main` image has been deployed to Kubernetes and verified on the
direct LAN route and the projects.lan proxied route.

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

After deploy, verify:

- `http://modelrailroadautomation.lan/api/firmware-status` returns HTTP 200.
- The Control page renders the Firmware panel.
- `GET /api/config` reports `authRequired: false` and
  `authConfigured: false` when `ALLOW_UNAUTHENTICATED_CONTROL=true` is active.
- Anonymous safe write checks such as `POST /api/refresh` return HTTP 200 on
  both direct and proxied routes without cookies, SSO, or a bearer token.
- Loading and refreshing firmware status sends no train, turnout, power, CV,
  raw command, or flash action.
- `GET http://modelrailroadautomation.lan/api/sessions/latest`
- the Control-page Session panel
- refreshing/exporting sessions does not add new DCC-EX tx events

After publishing `main`, add/verify a writable `/app/data` path in
`container-orchestrator/apps/model-railroad-automation/values.yaml` before
redeploying through `container-orchestrator`.

Rollback is a code revert plus deletion of session JSONL files or PVC contents
if desired. Do not touch `dcc-ex/`, sensor declarations, decoder CVs, or
firmware provenance artifacts for recorder rollback.
