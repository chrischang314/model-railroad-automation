# Changelog

All notable changes to this project will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com),
and the project tries to follow [Semantic Versioning](https://semver.org) for
its tagged releases (major = breaking layout change, minor = feature, patch =
bugfix or doc update).

## [Unreleased]

- (nothing pending; see open GitHub issues for tracked work)

## [1.1.0] - 2026-05-07

### Added

- **Headlight automation** in `dcc-ex/myAutomation.h`. Each sequence now
  toggles `FON(0)` at start and `FOFF(0)` after the home-station stop,
  so the leading headlight stays lit during motion and dwells, and the
  train looks "parked" between cycles.
- **Graceful stop** via a virtual run-flag at vpin 2001. A new
  `ROUTE(101, "Stop Shuttle Gracefully")` clears the flag with `RESET`;
  the dispatch check at the end of each sequence (`IF(2001) SENDLOCO ENDIF`)
  exits cleanly when the flag is cleared. The train completes its current
  cycle, returns home, and stops -- no emergency kill required.
- **Randomized station dwells** via `DELAYRANDOM(8000, 14000)` replacing
  the fixed `DELAY(10000)` at both endpoints. Removes the metronome feel
  of v1.0.0; gives a more prototypical timetabled-stop appearance.
- **Inline tuning comments** in `dcc-ex/myAutomation.h` explaining the
  rationale for cruise speed 80, creep 40, 3 s creep duration, and
  headlight bracketing. Future-you will not have to re-derive these.

### Changed

- `ROUTE(100, "Start Shuttle")` now sets the run flag in addition to
  dispatching Train 2.

### Migration notes

- After flashing v1.1.0, no new `<S>` declarations are required for the
  virtual run flag -- `SET(2001)` creates the vpin on demand. Sensor
  declarations for 1001 / 1002 are unchanged.
- Backwards-compatible at the trigger interface: `</START 100>` still
  starts the shuttle exactly as before. The new `</START 101>` is purely
  additive.

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

[Unreleased]: https://github.com/chrischang314/model-railroad-automation/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/chrischang314/model-railroad-automation/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/chrischang314/model-railroad-automation/releases/tag/v1.0.0
