# Model Railroad Web-Control Handoff

Last updated: 2026-05-20
Current branch: `main`

## Current Change

The control page now includes an All Stop button. It calls
`POST /api/trains/stop-all`, which sends `<t cab 0 direction>` for every train
listed in `web-control/src/layout.js`. The helper preserves the current known
direction bit so a soft stop does not accidentally flip train direction state.

This is intentionally different from Emergency Stop. All Stop stops configured
locomotives through throttle commands while leaving EXRAIL running; Emergency
Stop still sends `</KILL ALL>` and `<!>`.

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

Then click All Stop and confirm the command log shows one speed-zero throttle
command for each configured cab.

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
