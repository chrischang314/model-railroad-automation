# Model Railroad Project Handbook

## System Shape

This repo has two main operating surfaces:

- `dcc-ex/` holds the EXRAIL automation that runs on the DCC-EX command
  station.
- `web-control/` serves the projects.lan browser UI and translates operator
  actions into DCC-EX native commands.

The web-control server connects to the CSB1 over TCP and keeps a live state
snapshot for connection status, sensors, turnouts, train speeds, direction, and
recent command messages. In mock mode, the same state model is updated locally
so UI and API changes can be tested without hardware.

The `/health` endpoint is both a Kubernetes probe target and an operator
diagnostic payload. It intentionally keeps HTTP 200 so pod readiness does not
flap solely because the CSB1 or layout is idle, while the JSON `ok` and
`telemetry.stale` fields expose whether command-station messages are current.

The main control page reports each write action through a compact status strip
and bounded timestamped history so operators can see whether a command is still
sending, succeeded, or failed without scanning the command log.

The OTA updater and web-control UI share a read-only firmware provenance file.
The updater writes `/state/firmware-status.json` after baseline, no-change,
skipped, successful, warning, and failed runs. The web server reads that file
through `GET /api/firmware-status` and degrades missing, stale, malformed, or
failed proof into warning payloads instead of blocking the control page.

## Operator Safety Model

Use the least disruptive stop that fits the situation:

- Graceful Stop sends `</START 110>` so the EXRAIL automation can return trains
  home and end cleanly.
- All Stop sends speed-zero throttle commands to each configured cab while
  leaving EXRAIL alive.
- Emergency Stop sends `</KILL ALL>` and `<!>` for urgent shutdown.

All write/control APIs are protected by `CONTROL_TOKEN` when that environment
variable is set.

Firmware provenance is intentionally outside the write/control path. Reading or
refreshing it must not send DCC-EX commands, start EXRAIL routes, toggle power,
move turnouts, write decoder CVs, run shell commands, or trigger a flash.

## Change Rules

Keep hardware-facing behavior small and testable. Prefer mock-mode unit and
browser checks first, then live CSB1 checks only for changes that need physical
confirmation. Preserve existing element IDs and request paths unless a backend
change intentionally moves the contract. For telemetry and firmware-provenance
work, keep stale-age calculation and artifact normalization in testable backend
helpers and mirror only display formatting in the browser. Do not expose raw
updater logs, environment variables, WiFi credentials, Kubernetes Secret values,
or shell output through the LAN UI.
