# Web Control Server

Small web control panel for the DCC-EX command station. It serves a browser UI
and sends DCC-EX native commands to either:

- the EX-CSB1 directly over TCP, normally `dccex.local:2560`, or
- JMRI's DCC++ Over TCP server if you prefer JMRI as the bridge.

## Run Locally

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
| `CONTROL_TOKEN` | empty | Optional bearer token for write/control requests |
| `ROSTER_FILE` | `web-control/data/roster.json` | Local website roster metadata store |
| `TELEMETRY_STALE_MS` | `15000` | Command-station message age before UI and `/health` mark telemetry stale |

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
