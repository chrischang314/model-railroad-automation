# Model Railroad Web-Control Handoff

Last updated: 2026-05-21
Current branch: `projects-lan-implementer-b-2026-05-21-railroad-action-status`

## Current Change

Implementer B adds a control-page action status strip. Every main control write
action now reports sending, success, or failure through the `#actionStatus`
`aria-live` region and temporarily disables the clicked button while the request
is in flight. All Stop behavior from `main` is unchanged.

## Verification

Run the focused tests from `web-control/`:

```powershell
& "C:\Program Files\cursor\resources\app\resources\helpers\node.exe" --test
```

For browser verification, run mock mode and open the control page:

```powershell
$env:DCCEX_MOCK = "true"
$env:PORT = "3000"
& "C:\Program Files\cursor\resources\app\resources\helpers\node.exe" src/server.js
```

Then click Refresh, Power On, All Stop, a turnout action, and a train stop.
Confirm the status strip changes from sending to a success message and failures
show the red error state.

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
