# Changelog

All notable changes to this project will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com),
and the project tries to follow [Semantic Versioning](https://semver.org) for
its tagged releases (major = breaking layout change, minor = feature, patch =
bugfix or doc update).

## [Unreleased]

- Mount IR sensor pairs for sensors 1003 and 1004 (hardware path is wired
  through to the CSB1 already; just needs physical installation and
  uncommenting in `dcc-ex/sensor-setup-commands.txt`).

## [1.0.0] - 2026-05-07

### Added

- Initial GitHub project import. Two-train sensor-driven shuttle running on a
  Kato Unitrack layout, with infinite loop behavior.
- `arduino/RIR4_GPIO_Mirror/RIR4_GPIO_Mirror.ino` Arduino sketch that reads
  the Azatrax RIR4 over I2C and mirrors detector states to digital pins
  D4..D7. Polls every 50 ms, drives LOW when occupied / HIGH when vacant.
- `dcc-ex/myAutomation.h` EXRAIL script with `ROUTE(100)`, `SEQUENCE(10)` for
  Train 2, and `SEQUENCE(20)` for Train 4. Cruise speed 80, slowdown 40,
  3 s creep, 10 s stop, infinite loop via mutual `SENDLOCO` calls.
- `dcc-ex/myAutomation-backup.h` snapshot of the v1.0.0 known-good script.
- `dcc-ex/sensor-setup-commands.txt` runtime `<S>` declarations to be re-sent
  after every CSB1 firmware flash.
- `docs/handoff-document.md` comprehensive ~970-line technical reference
  covering project overview, system architecture, hardware inventory, layout,
  software stack, wiring, source code, setup procedures, common operations,
  lessons learned, troubleshooting, future expansion, LLM-specific guidance,
  references, glossary, and project status.
- `docs/layout-diagram.md`, `docs/wiring-diagram.md`,
  `docs/lessons-learned.md` focused excerpts of the handoff document for
  faster lookup.
- `reference/command-cheatsheet.md` DCC-EX commands used in this project.
- `reference/csb1-gpio-pin-allocation.md` ESP32 pin map (in-use, reserved,
  blocked).
- `reference/decoder-cv-reference.md` decoder CV settings and tuning notes.
- `reference/i2c-address-allocation.md` I2C bus address map.
- `jmri/notes.md` JMRI configuration notes.
- `future/ideas.md` short/medium/long-term expansion ideas.
- `future/shopping-list.md` hardware queue for those ideas.
- `arduino/RIR4_GPIO_Mirror/README.md` step-by-step bring-up guide for
  the Arduino + RIR4 stack, including CH340 driver hints, blink test as
  the first diagnostic, and the LOW=occupied polarity convention.
- `LICENSE` (MIT).

### Enriched from the project's chat history

The handoff document is the master reference, but the following details
were also extracted from earlier discussions and folded into the focused
project files:

- Kato Terminal Unijoiner part numbers (#24-818 N scale, #24-827 HO scale)
  added to `docs/wiring-diagram.md`.
- Kato #20-210 double crossover power-feed quirk (four feed locations,
  two-feeder rule) added to `docs/wiring-diagram.md`.
- mDNS hostname `dccex.local`, DHCP reservation tip, EX-WebThrottle as a
  network diagnostic, and JMRI manual-reconnect quirk added to
  `jmri/notes.md` and `docs/lessons-learned.md`.
- RIR4 DIP-switch addressing (3 switches -> 8 possible I2C addresses,
  current setting 0x38) added to `reference/i2c-address-allocation.md`.
- FR11 default function mapping (interior lights on F0, not F1) and the
  "no decoder detected" PROG-track gotcha (with PowerPax/PTB-100/blind-
  write workarounds) added to `reference/decoder-cv-reference.md`.
- Three Kato consist methods (same-address, CV19 advanced consist,
  WiThrottle multi-select) added to `reference/decoder-cv-reference.md`.
- PDL magnetic programming step-by-step (magnet placement, JMRI Turnout
  Table flow, CV1/CV9 update, broadcast disable for sound-loco
  immunity) added to `reference/decoder-cv-reference.md`.

### Hardware tested at this version

- DCC-EX firmware: **5.6.0-Prod** (build `master-202605011818Z`)
- Cruise speed: **80**, slowdown speed: **40**, slowdown duration: **3 s**,
  station dwell: **10 s**
- Run mode: infinite loop (Train 2 -> Train 4 -> Train 2 -> ...)

### Verified

- Both trains complete out-and-back cycles without missing a sensor trigger.
- Slowdown / stop / pause / reverse sequence executes as designed.
- Turnout 2 reliably switches between Train 2 and Train 4 between dispatches.
- Loop continues until manually stopped via `</KILL ALL>` and `<!>`.

### Known limitations

- Sensor declarations do not always persist across firmware reflashes; must
  be re-sent from `dcc-ex/sensor-setup-commands.txt`.
- No graceful "stop after current cycle" mechanism; only immediate stop.
- Speeds above 80 cause overshoot at sensor 1002.

[Unreleased]: https://github.com/chrischang16173/model-railroad-automation/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/chrischang16173/model-railroad-automation/releases/tag/v1.0.0
