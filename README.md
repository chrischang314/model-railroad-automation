# Model Railroad Automation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/chrischang314/model-railroad-automation?include_prereleases&sort=semver)](https://github.com/chrischang314/model-railroad-automation/releases)
[![Last commit](https://img.shields.io/github/last-commit/chrischang314/model-railroad-automation)](https://github.com/chrischang314/model-railroad-automation/commits/main)
[![DCC-EX](https://img.shields.io/badge/DCC--EX-5.6.0--Prod-blue)](https://dcc-ex.com)

Sensor-driven two-train shuttle automation built on a DCC-EX **EX-CSB1** command
station with **Azatrax RIR4** IR detectors bridged through an **Arduino Uno**.
Trains run autonomously between sensor-defined endpoints on a shared track,
alternating via a turnout-managed station.

## Quick start

Trigger the shuttle (once configured; send BOTH commands, in either order):

```
</START 100>
</START 200>
```

Stop gracefully (current cycle finishes, then no further dispatch):

```
</START 110>
```

Stop immediately (kills running tasks, freezes loco motors):

```
</KILL ALL>
<!>
```

After every CSB1 firmware flash, re-add sensor declarations:

```
<S 1001 33 0>
<S 1002 26 0>
```

(See [`dcc-ex/sensor-setup-commands.txt`](dcc-ex/sensor-setup-commands.txt) for
the canonical list, including reserved sensors.)

## Project status

Operational. Two trains running an infinite-loop shuttle on a shared long
track. Sensors 1001/1002 wired and tuned; sensors 1003/1004 reserved for future
installation. See [`CHANGELOG.md`](CHANGELOG.md) for version history.

## Architecture

```
Physical IR pairs (4 channels)
        |
        v
   Azatrax RIR4 shield  (5 V, I2C slave to its onboard MCU)
        |
        v  I2C @ 5 V (internal to Arduino + RIR4 stack)
        |
   Arduino Uno R3      (5 V, runs RIR4_GPIO_Mirror.ino)
   Reads RIR4 over I2C, mirrors detector states to D4..D7
        |
        v  4 digital signals at 5 V
        |
   BSS138 4-channel level shifter
        |
        v  4 digital signals at 3.3 V
        |
   EX-CSB1 GPIO inputs (IO33, IO26, IO16, IO17)
   DCC-EX firmware reads as standard sensor pins
        |
        v  DCC-EX network protocol (port 2560)
        |
   JMRI / WiThrottle / EXRAIL  (sensors 1001..1004)
```

The detailed reasoning behind this architecture (and the alternatives that did
not work) lives in [`docs/handoff-document.md`](docs/handoff-document.md).

## Repository layout

```
.
├── README.md                    project overview (this file)
├── LICENSE                      MIT
├── CHANGELOG.md                 version history
├── arduino/
│   └── RIR4_GPIO_Mirror/        Arduino sketch: reads RIR4 over I2C,
│       └── RIR4_GPIO_Mirror.ino mirrors detector state to GPIO pins
├── dcc-ex/
│   ├── myAutomation.h           current EXRAIL automation script
│   ├── myAutomation-backup.h    last known-good copy
│   ├── sensor-setup-commands.txt runtime <S> commands re-applied after flash
│   └── archived/                superseded versions (pre-git)
├── docs/
│   ├── handoff-document.md      master technical reference (~970 lines)
│   ├── layout-diagram.md        track topology, sensor placement
│   ├── wiring-diagram.md        every wire and terminal documented
│   ├── lessons-learned.md       distilled DOs / DON'Ts / mistakes
│   └── images/                  photos, diagrams, screenshots
├── reference/
│   ├── command-cheatsheet.md    DCC-EX commands used in this project
│   ├── csb1-gpio-pin-allocation.md ESP32 pin map (in-use, reserved, blocked)
│   ├── decoder-cv-reference.md  decoder CV settings and tuning notes
│   └── i2c-address-allocation.md addresses on the I2C bus
├── jmri/
│   ├── panels/                  JMRI panel XML files (when added)
│   └── notes.md                 JMRI configuration notes
└── future/
    ├── ideas.md                 expansion ideas (short/medium/long term)
    └── shopping-list.md         hardware to acquire for those ideas
```

## Key technologies

- [DCC-EX](https://dcc-ex.com) — open-source DCC command station firmware
- [JMRI](https://www.jmri.org) — model railroad interface software
- [EXRAIL](https://dcc-ex.com/exrail/) — DCC-EX's automation scripting language
- [Azatrax RIR4](https://www.azatrax.com) — 4-channel IR sensor shield
- [Arduino Uno R3](https://store.arduino.cc/products/arduino-uno-rev3) —
  bridge microcontroller
- [Adafruit BSS138 4-channel level shifter](https://www.adafruit.com/product/757) —
  5 V <-> 3.3 V translator

## Hardware roster

See [Section 3 of the handoff document](docs/handoff-document.md#3-hardware-inventory-and-materials)
for the full bill of materials. Highlights:

- DCC-EX EX-CSB1 (bare, ESP32-based, 3.3 V)
- Kato Unitrack with Terminal Unijoiner power feed
- Two Kato locomotives (Shinkansen DCC #2, E233 DCC #4) with EM13 motor decoders
- Two Kato turnouts with Proto Design Labs accessory decoders
- Azatrax RIR4 with 4 IR sensor pairs (2 currently mounted)
- Arduino Uno R3 + BSS138 level shifter

## Layout overview

Two trains park on parallel station tracks. Turnout 2 selects which train enters
the shared long track. Each train runs out at speed 80, slows to speed 40 at the
far sensor, creeps for 3 s, stops 10 s, then reverses home — and the turnout
flips for the other train. The cycle repeats indefinitely.

| Object | ID | Vpin / Address | Notes |
| --- | --- | --- | --- |
| Sensor 1001 | 1001 | vpin 33 | Home end of long track |
| Sensor 1002 | 1002 | vpin 26 | Far end of long track |
| Sensor 1003 (reserved) | 1003 | vpin 16 | Wired through, no IR pair installed |
| Sensor 1004 (reserved) | 1004 | vpin 17 | Wired through, no IR pair installed |
| Turnout 1 | 1 | DCC accessory 1 | Reserved (currently unused) |
| Turnout 2 | 2 | DCC accessory 2 | Station turnout, switches between Train 2 and Train 4 |
| Loco "KATO Shinkansen" | DCC 2 | n/a | Train A (turnout thrown) |
| Loco "KATO E233" | DCC 4 | n/a | Train B (turnout closed) |

## Where to look first

| Goal | Open this file |
| --- | --- |
| One-stop comprehensive reference | [`docs/handoff-document.md`](docs/handoff-document.md) |
| Make a code change to the EXRAIL script | [`dcc-ex/myAutomation.h`](dcc-ex/myAutomation.h) |
| Make a code change to the Arduino sketch | [`arduino/RIR4_GPIO_Mirror/RIR4_GPIO_Mirror.ino`](arduino/RIR4_GPIO_Mirror/RIR4_GPIO_Mirror.ino) |
| Bring up a fresh Arduino + RIR4 stack | [`arduino/RIR4_GPIO_Mirror/README.md`](arduino/RIR4_GPIO_Mirror/README.md) |
| Look up a DCC-EX command | [`reference/command-cheatsheet.md`](reference/command-cheatsheet.md) |
| Check which CSB1 GPIO pins are free | [`reference/csb1-gpio-pin-allocation.md`](reference/csb1-gpio-pin-allocation.md) |
| Trace a wire | [`docs/wiring-diagram.md`](docs/wiring-diagram.md) |
| Avoid past mistakes | [`docs/lessons-learned.md`](docs/lessons-learned.md) |
| Plan the next feature | [`future/ideas.md`](future/ideas.md) |

## Recent changes

See [`CHANGELOG.md`](CHANGELOG.md).

## Working with this repository

Typical update workflow when changing the EXRAIL script:

```bash
# Edit dcc-ex/myAutomation.h
git diff
git add dcc-ex/myAutomation.h
git commit -m "Reduce cruise speed from 80 to 70 (overshoot at sensor 1002)"
git push
```

Use feature branches for risky experiments (`git checkout -b experiment-...`)
and tag working configurations (`git tag -a v1.1 -m "..."`). The
[`docs/handoff-document.md`](docs/handoff-document.md) Section 13 includes
LLM-specific guidance for any future AI assistance on this project.

## License

[MIT](LICENSE).
