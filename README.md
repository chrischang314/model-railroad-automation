# Model Railroad Automation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/chrischang314/model-railroad-automation)](https://github.com/chrischang314/model-railroad-automation/commits/main)
[![DCC-EX](https://img.shields.io/badge/DCC--EX-5.6.0--Prod-blue)](https://dcc-ex.com)

Sensor-driven model railroad automation built on a DCC-EX EX-CSB1 command
station with Azatrax RIR4 beam-break sensors bridged through an Arduino Uno.

Current stable automation: `dcc-ex/myAutomation.h` v3.16.0-STABLE.

## Quick Start

After flashing the CSB1, re-send the physical sensor declarations:

```text
<S 1001 33 0>
<S 1002 26 0>
```

Start the full shuttle:

```text
</START 100>
```

Stop gracefully:

```text
</START 110>
```

Emergency stop:

```text
</KILL ALL>
<!>
```

`</START 200>` and `</START 290>` are diagnostic routes only.

## Current Stable Behavior

- Train 2 shuttles continuously on the top track.
- Train 4 and Train 5 alternate on the middle/spur route.
- Train 2 and the active middle train pass each other during paired crossings.
- S1 and S2 are shared beam-break sensors across both tracks, so the script
  uses EXRAIL software handshakes to prevent false arrivals.
- Random station dwell is 3 to 8 seconds.
- Cruise speed is 40; creep speed is 20.
- Train 5 uses a 10 second creep period for the spur transition.

## Layout Summary

```text
Top track:    -------- Train 2 shuttle ----------------
                       ^ S1                       ^ S2
                       | vpin 33                  | vpin 26
                       | shared beam              | shared beam
                       v                           v
Middle track: --T2-----+------------ T1 ----------+---T3----
Spur:             \--- Train 5 home
```

| Object | ID / address | Notes |
| --- | --- | --- |
| S1 | Sensor 1001, vpin 33 | Shared west/home-side beam |
| S2 | Sensor 1002, vpin 26 | Shared east/far-side beam |
| T1 | Turnout 1 | Starts thrown |
| T2 | Turnout 2 | Thrown for Train 4, closed for Train 5 |
| T3 | Turnout 3 | Starts thrown |
| Train 2 | DCC 2 | Top track |
| Train 4 | DCC 4 | Middle main |
| Train 5 | DCC 5 | Spur |

## Repository Layout

```text
.
|-- README.md
|-- LICENSE
|-- CHANGELOG.md
|-- arduino/
|   `-- RIR4_GPIO_Mirror/
|       |-- RIR4_GPIO_Mirror.ino
|       `-- README.md
|-- dcc-ex/
|   |-- myAutomation.h
|   |-- myAutomation-backup.h
|   |-- sensor-setup-commands.txt
|   `-- archived/
|-- docs/
|   |-- handoff-document.md
|   |-- layout-diagram.md
|   |-- wiring-diagram.md
|   `-- lessons-learned.md
|-- reference/
|   |-- command-cheatsheet.md
|   |-- csb1-gpio-pin-allocation.md
|   |-- decoder-cv-reference.md
|   `-- i2c-address-allocation.md
|-- jmri/
|   `-- notes.md
`-- future/
    |-- ideas.md
    `-- shopping-list.md
```

## Where To Look First

| Goal | File |
| --- | --- |
| Current EXRAIL automation | [`dcc-ex/myAutomation.h`](dcc-ex/myAutomation.h) |
| Run browser-based train control | [`web-control/README.md`](web-control/README.md) |
| Set up automatic CSB1 reflashing | [`ota-updater/README.md`](ota-updater/README.md) |
| Stable backup copy | [`dcc-ex/myAutomation-backup.h`](dcc-ex/myAutomation-backup.h) |
| Future-LLM handoff and troubleshooting | [`docs/handoff-document.md`](docs/handoff-document.md) |
| Fast rules and pitfalls | [`docs/lessons-learned.md`](docs/lessons-learned.md) |
| Physical layout | [`docs/layout-diagram.md`](docs/layout-diagram.md) |
| Runtime commands | [`reference/command-cheatsheet.md`](reference/command-cheatsheet.md) |
| Sensor declarations | [`dcc-ex/sensor-setup-commands.txt`](dcc-ex/sensor-setup-commands.txt) |

## Key EXRAIL Lessons

- `AT()` takes vpins, not sensor IDs: use `AT(33)` and `AT(26)`.
- Physical sensors are declared with runtime `<S ...>` commands, not a
  `SENSOR(...)` macro in this DCC-EX 5.6.0 setup.
- Virtual flags need `HAL(Bitmap, 2000, 20)` so `SET`/`RESET` and
  `IF`/`AT` share state.
- With shared beam sensors, use `AFTER(...)` only for the train's own
  departure beam.
- Do not add random departure delays while S1/S2 span both tracks.

## Web Control

A small Docker-deployable web server lives in [`web-control/`](web-control/).
It can connect directly to the EX-CSB1 on TCP port 2560, or to JMRI's DCC++
Over TCP bridge. The first UI includes shuttle start/stop, emergency stop,
track power, turnout control, train throttle controls, F0/headlight toggles,
sensor status, and a command log.

```bash
docker compose up --build
```

## License

[MIT](LICENSE).
