# Model Railroad Web-Control Handoff

Last updated: 2026-06-02
Current branch: `codex/projects-lan-sso-model-railroad`

## Current Change

This change refactors web-control write authorization around projects.lan SSO
and a separate hardware safety gate. It does not change EXRAIL or run live
movement tests.

- `web-control/src/shared-auth.js` validates the `projects_lan_session` cookie
  by hashing it and reading `auth_sessions` joined to `users` in
  `SHARED_AUTH_DB`.
- `web-control/src/server.js` keeps `/health`, `GET /api/state`,
  `GET /api/roster`, `GET /api/events`, and `GET /api/firmware-status` public.
  Unsafe writes require SSO; cookie-backed `POST`/`DELETE` also require the
  same-origin guard and the `X-CSRF-Token` from `GET /api/config`.
- Physical hardware commands require SSO plus `HARDWARE_CONTROL_ALLOWLIST` or a
  short-lived arm created by `POST /api/hardware-arm` with
  `HARDWARE_ARM_TOKEN`.
- Roster metadata writes and `/api/refresh` require SSO plus CSRF, but not the
  hardware arm gate.
- `CONTROL_TOKEN` remains only for explicit compatibility mode:
  set both `CONTROL_TOKEN` and `CONTROL_TOKEN_COMPAT_MODE=true`. The browser no
  longer sends localStorage tokens as authorization.
- `web-control/public/app.js` and `web-control/public/operations.js` now send
  only `X-CSRF-Token` on writes and use the token input only for hardware arm.
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

## Deployment Notes

This branch has not been pushed, merged, or deployed.

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
- The Control page renders the Firmware panel and operator auth/arm status.
- Signed-in unsafe browser writes include `X-CSRF-Token` and pass same-origin
  checks.
- Hardware commands fail until the signed-in user is allowlisted or armed.
- Loading and refreshing firmware status sends no train, turnout, power, CV,
  raw command, or flash action.

Rollback is a normal revert of the updater status writer, web-control endpoint,
UI panel, and container-orchestrator status-path mount. Leave
`last-flashed.sha256` untouched.
