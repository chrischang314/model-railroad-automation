# Web Control Server

Small web control panel for the DCC-EX command station. It serves a browser UI
and sends DCC-EX native commands to either:

- the EX-CSB1 directly over TCP, normally `dccex.local:2560`, or
- JMRI's DCC++ Over TCP server if you prefer JMRI as the bridge.

## Run Locally

Requires Node >=22.5. The Docker image uses Node 24 so the server can read the
shared SQLite auth database through Node's built-in `node:sqlite` module.

Mock mode, no command station required:

```bash
cd web-control
$env:DCCEX_MOCK="true"; node src/server.js
```

Real command station:

```bash
cd web-control
$env:DCCEX_HOST="192.168.4.22"; $env:DCCEX_PORT="2560"; node src/server.js
```

Open <http://localhost:3000>.

The programming/workbench page is available at
<http://localhost:3000/operations.html>.

## Docker

From the repo root:

```bash
docker compose up --build
```

Or build directly:

```bash
docker build -t model-railroad-web-control ./web-control
docker run --rm -p 3000:3000 -e DCCEX_HOST=192.168.4.22 model-railroad-web-control
```

If the CSB1's IP changes, override `DCCEX_HOST` with the new address:

```bash
docker run --rm -p 3000:3000 -e DCCEX_HOST=192.168.4.99 model-railroad-web-control
```

Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port inside the container |
| `DCCEX_HOST` | `192.168.4.22` | CSB1 or JMRI DCC++ Over TCP host |
| `DCCEX_PORT` | `2560` | DCC-EX TCP port |
| `DCCEX_MOCK` | `false` | Set `true` for UI testing without hardware |
| `SHARED_AUTH_DB` | `~/.local-webapps/auth.db` | Shared SQLite auth database containing `users` and `auth_sessions` |
| `HARDWARE_ARM_TOKEN` | empty | Optional one-time arm secret that signed-in operators can use to arm hardware commands for `HARDWARE_ARM_TTL_MS` |
| `HARDWARE_ARM_TTL_MS` | `900000` | Hardware arm lifetime in milliseconds |
| `HARDWARE_CONTROL_ALLOWLIST` | empty | Comma-separated usernames, username keys, numeric user IDs, or `id:<id>` entries allowed to send hardware commands without arming |
| `ALLOWED_ORIGINS` | empty | Extra comma-separated origins allowed by the CSRF origin guard; the request host is allowed automatically |
| `CSRF_SECRET` | random per process | HMAC secret for the server-issued CSRF token shown in `GET /api/config` |
| `CONTROL_TOKEN` | empty | Legacy bearer token, accepted only when `CONTROL_TOKEN_COMPAT_MODE=true` |
| `CONTROL_TOKEN_COMPAT_MODE` | `false` | Explicit compatibility mode for old service clients that still send `Authorization: Bearer ...` or `X-Control-Token` |
| `ROSTER_FILE` | `web-control/data/roster.json` | Local website roster metadata store |
| `TELEMETRY_STALE_MS` | `15000` | Command-station message age before UI and `/health` mark telemetry stale |
| `FIRMWARE_STATUS_FILE` | `web-control/data/firmware-status.json` | Read-only updater provenance JSON file shown by `/api/firmware-status` |
| `FIRMWARE_STATUS_STALE_MS` | 7 days | Firmware proof age before the UI reports it stale |
| `SESSION_DATA_DIR` | `web-control/data/sessions` | JSONL operating session log directory |
| `SESSION_RETENTION_COUNT` | `10` | Maximum completed session files to keep |
| `SESSION_RETENTION_DAYS` | `7` | Maximum age of session files to keep |

## Auth And Hardware Safety

Read-only status endpoints stay public, including `/health`, `GET /api/state`,
`GET /api/roster`, and `GET /api/firmware-status`.

Unsafe browser writes use the `projects_lan_session` cookie for identity. The
server hashes that cookie and validates it against `auth_sessions` joined to
`users` in `SHARED_AUTH_DB`; the browser no longer sends a bearer token from
localStorage. Cookie-backed `POST` and `DELETE` requests must also include the
same-origin `Origin` or `Referer` plus the `X-CSRF-Token` returned by
`GET /api/config`.

Physical hardware commands have a second gate after SSO. Raw commands, power,
throttle, functions, turnouts, automation start/stop, emergency stop, all stop,
and programming commands require the signed-in user to be in
`HARDWARE_CONTROL_ALLOWLIST` or to arm hardware control with
`POST /api/hardware-arm` and `HARDWARE_ARM_TOKEN`. Roster metadata writes and
the safe `/api/refresh` status poll require SSO and CSRF, but not hardware arm.

`CONTROL_TOKEN` remains only as an explicit compatibility path for scripts or
service clients. It is ignored unless `CONTROL_TOKEN_COMPAT_MODE=true`, and the
browser UI does not read it from localStorage or send it as authorization.

## Implemented Controls

- Start stable EXRAIL shuttle: `</START 100>`
- Graceful stop: `</START 110>`
- Emergency stop: `</KILL ALL>` then `<!>`
- Track power: `<1>` / `<0>`
- Turnouts: `<T id 1>` for thrown, `<T id 0>` for closed
- Trains: `<t cab speed direction>`
- All Stop: sends `<t cab 0 direction>` for every configured cab, preserving
  the current known direction bit for each train.
- F0/headlights: `<F cab 0 state>`
- Sensor status: `<Q>` plus live `<Q id>` / `<q id>` broadcasts
- Sensor setup on backend connect: `<S 1001 33 0>` and `<S 1002 26 0>`
- Telemetry freshness: the control and programming headers show the age of the
  last command-station message and turn amber when it exceeds
  `TELEMETRY_STALE_MS`.
- Health details: `/health` keeps HTTP 200 for Kubernetes probes, but its JSON
  `ok` field turns false when the command station is disconnected or telemetry
  is stale. It includes active sensors, moving trains, power, automation, and
  telemetry age data for LAN dashboards.
- Control action feedback: the main control panel reports when a write action is
  sending, succeeds, or fails, and keeps a bounded timestamped history of recent
  control actions without requiring the operator to read the full command log.
- Firmware provenance: the main control panel reads
  `GET /api/firmware-status` and shows the latest updater status artifact,
  including expected EXRAIL version/hash, last flash or baseline time, and
  post-flash sensor setup result. This endpoint is public and read-only; it does
  not send DCC-EX commands or start a firmware build.
- Operating session recorder: the backend writes structured JSONL events for
  operator actions, DCC-EX tx/rx messages, power, turnout, sensor, automation,
  all-stop, emergency-stop, and telemetry stale/recovered transitions. The
  Control page shows latest status and an export link. Read-only APIs:
  `/api/sessions/latest`, `/api/sessions`, and
  `/api/sessions/<session-id>/export`.

## Session Data

Local `docker compose` mounts `./web-control/data` to `/app/data` so session
exports survive container restarts. The directory is ignored by git. To roll
back the recorder, revert the code/docs change and remove the JSONL files or
PVC contents if they are no longer useful. Session files are diagnostics, not a
source of truth for train state.

## Programming Workbench

The `/operations.html` page mirrors the JMRI workflows that map cleanly to
DCC-EX native commands:

- Direct command console for arbitrary DCC-EX commands.
- Local roster metadata editor with address, model, decoder, function labels,
  and notes.
- DecoderPro-style programming track helpers for `<R>`, `<R cv>`, `<W cv value>`,
  and `<W address>`.
- Ops-mode programming helpers for `<w cab cv value>` and `<b cab cv bit value>`.
- PanelPro-style turnout and sensor table helpers for `<T ...>`, `<S ...>`,
  `<Q>`, and `<E>`.

DCC-EX reports roster entries with `<JR>`, but rich DecoderPro roster metadata
is a JMRI-side file concept. The web roster therefore stores local metadata in
`ROSTER_FILE`; decoder programming still goes directly to the command station.

## References

- DCC-EX native command summary:
  <https://dcc-ex.com/reference/software/command-summary-consolidated.html>
- DCC-EX EXRAIL command reference:
  <https://dcc-ex.com/exrail/exrail-command-reference.html>
- JMRI DCC-EX hardware support:
  <https://www.jmri.org/help/en/html/hardware/dcc-ex/index.shtml>
- JMRI DecoderPro:
  <https://www.jmri.org/help/en/package/apps/gui3/dp3/DecoderPro3.shtml>
- JMRI JSON servlet:
  <https://www.jmri.org/help/en/html/web/JsonServlet.shtml>
