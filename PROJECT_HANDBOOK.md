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

The browser header and `/health` endpoint also classify telemetry freshness.
If the TCP socket is connected but the last CSB1 message is older than the
freshness window, operators get a stale warning instead of a misleading plain
connected state.

## Operator Safety Model

Use the least disruptive stop that fits the situation:

- Graceful Stop sends `</START 110>` so the EXRAIL automation can return trains
  home and end cleanly.
- All Stop sends speed-zero throttle commands to each configured cab while
  leaving EXRAIL alive.
- Emergency Stop sends `</KILL ALL>` and `<!>` for urgent shutdown.

All write/control APIs are protected by `CONTROL_TOKEN` when that environment
variable is set.

## Change Rules

Keep hardware-facing behavior small and testable. Prefer mock-mode unit and
browser checks first, then live CSB1 checks only for changes that need physical
confirmation. Preserve existing element IDs and request paths unless a backend
change intentionally moves the contract.
