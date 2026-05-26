# Model Railroad Web-Control Handoff

Last updated: 2026-05-21
Current branch: merged telemetry health and control action status work

## Current Change

This merge combines telemetry staleness visibility with control-page action
feedback because both improve operator confidence without changing the
hardware-facing command contracts.

The telemetry health work adds a reliability-oriented implementation:

- `web-control/src/telemetry-health.js` builds a tested health payload with
  telemetry age, stale status, moving trains, active sensors, power, and
  automation state.
- `/health` still returns HTTP 200 for Kubernetes probe stability, but its JSON
  `ok` field now turns false when the command station is disconnected or
  telemetry is stale.
- `/api/config` exposes `TELEMETRY_STALE_MS`, defaulting to 15 seconds.
- The Control and Programming page headers show the last command-station
  message age and turn amber when telemetry is stale.
- The main control page reports each write action through the `#actionStatus`
  `aria-live` region, records a bounded timestamped entry in `#actionHistory`,
  and temporarily disables the clicked button while the request is in flight.

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
Then click Refresh, Power On, All Stop, a turnout action, and a train stop.
Confirm the status strip changes from sending to a success message, the recent
action history stays bounded, and failures show the red error state.

## Deployment Notes

The Kubernetes app is defined in
`C:\Users\chris\Projects\container-orchestrator\apps\model-railroad-automation\values.yaml`
and currently tracks the `main` image tag.

The All Stop change was merged to `main`, published by the GitHub Actions
`build-and-push` workflow, and deployed on 2026-05-20 with:

```powershell
& "C:\Users\chris\.codex\tools\helm-v4.2.0\helm.exe" lint charts\app -f apps\model-railroad-automation\values.yaml
& "C:\Users\chris\.codex\tools\helm-v4.2.0\helm.exe" upgrade --install model-railroad-automation charts/app -f apps/model-railroad-automation/values.yaml --namespace default --create-namespace --wait --timeout 5m
kubectl rollout restart deployment/model-railroad-automation-web-control -n default
kubectl rollout status deployment/model-railroad-automation-web-control -n default --timeout=180s
```

The live LAN page at `http://modelrailroadautomation.lan/` includes the All Stop
button, and `POST /api/trains/stop-all` was smoke-tested while the railroad was
idle.

Implementer C did not push, merge, publish, or deploy this branch because the
feature pipeline expects a judge to compare A/B/C implementations first. After
judge selection, publish the winning branch to `main`, wait for the GHCR
`web-control:main` image, then redeploy through `container-orchestrator` and
verify `http://modelrailroadautomation.lan/health`.
