# Future Expansion Ideas

A staging area for things to build next. Items move out of this file as they
become real GitHub issues or actual `myAutomation.h` changes. Order roughly
goes "easiest first."

## Short-term (current hardware, software-only changes)

### Mount sensor pairs 3 and 4

Hardware path is wired through to the CSB1 already. Only the IR pairs need to
be physically installed at chosen track positions. Then:

1. Choose physical positions for sensors 1003 and 1004 (e.g. mid-track or
   approach to a future turnout).
2. Mount the IR LED + phototransistor across the rails at each chosen point.
3. Wire each pair into the RIR4's terminal blocks for detector 3 and 4
   (3K/3F/X and 4K/4F/X).
4. Uncomment the `<S 1003 16 0>` and `<S 1004 17 0>` lines in
   [`../dcc-ex/sensor-setup-commands.txt`](../dcc-ex/sensor-setup-commands.txt)
   and re-send them.
5. Verify in JMRI's sensor table that 1003 and 1004 toggle when triggered.

The Arduino sketch already polls all four detectors -- no sketch change needed.

### Refine directional lighting

Basic headlight automation already exists in `dcc-ex/myAutomation.h`. A future
refinement would distinguish leading and trailing lights where the decoder
function map supports that, so only the forward-facing end is lit during each
leg.

### Show flashed EXRAIL version in the web UI

Add a status panel to `web-control` that shows:

1. The currently flashed `myAutomation.h` version reported by the CSB1 or OTA
   updater state.
2. The latest `main` branch `myAutomation.h` version from GitHub.
3. The latest patch notes from the `myAutomation.h` header or a small generated
   metadata file.

The clean implementation is probably for the OTA updater to write a small
status JSON document after each successful flash, then have the web server read
that state or expose it through an internal API. Avoid scraping raw Kubernetes
logs from the browser-facing app.

### Tune decoder speed tables

Set CV5 (Vmax) on both locos so `FWD(40)` looks identical in real life. Then
tune CV6 (Vmid) so the speed curve is roughly linear from creep to cruise.
DecoderPro makes this easy. See
[`../reference/decoder-cv-reference.md`](../reference/decoder-cv-reference.md)
for current recommended values.

### Add station-arrival horn

If/when a sound-equipped loco joins the roster, insert `FON(2)` (typical horn
function) for ~500 ms at each STOP. Pair with `FOFF(2)` immediately after.

## Medium-term (small hardware additions)

### Add an MCP23017 GPIO expander on the Qwiic header

About $5. Plugs into the CSB1's I2C Qwiic connector, gives 16 more
sensor-capable pins without consuming any CSB1 GPIO. Useful when:

- The MotorShield8874 lands on the CSB1 and consumes the existing GPIO range.
- More than 4 sensor pairs are needed and another RIR4 + Arduino seems like
  overkill.
- LED signals or low-current indicators are wanted on the layout.

DCC-EX has built-in HAL support for the MCP23017 -- a single `HAL()` line in
`myAutomation.h` exposes its 16 pins as new vpins.

### Add LED signals

Drive trackside signals (red/yellow/green) from CSB1 GPIO outputs (or via
the MCP23017 above). Control via EXRAIL: when `AT(33)` triggers, set the
signal LED for that block. Pair with the existing turnout state for a
miniature CTC effect.

### Stack a second RIR4

The Azatrax RIR4 supports up to 8 boards on a single Arduino with unique
I2C addresses (set by DIP switches). Adding a second RIR4 doubles sensor
capacity to 8 pairs without changing the CSB1 side -- just expand the
Arduino sketch to also drive D8..D11 (or use a SPI-based level shifter for
more channels).

### Servo-driven turnouts

Kato turnouts ship with solenoid actuators. A common hobby modification is
to remove them and replace with hobby servos for slower, scale-correct
throws and quieter operation. The PCA9685 16-channel PWM driver
(I2C, 0x40) is the usual servo controller; DCC-EX has HAL support.

## Long-term (significant additions)

### Multi-block detection for prototypical signaling

ABS (Automatic Block Signaling) or APB (Absolute Permissive Block) requires
occupancy detection across multiple blocks. Combine with LED signals for a
visually convincing dispatcher's perspective. Requires either many more IR
pairs or current-detection on each block.

### Reverse loop

A loop that lets a train reverse direction without stopping. Requires:

- Auto-reverser module (commercial: e.g. NCE AR-10).
- Block isolation gaps at the loop entries.
- EXRAIL coordination so the loco command direction matches the new physical
  direction after the loop.

### JMRI Dispatcher

Full CTC-style operation with multiple trains, complex routing, and
collision avoidance. Replaces the per-train EXRAIL sequences with a
declarative track plan. Significant configuration effort, but very rewarding.

### Operations sessions

JMRI Operations is a freight-car switching simulator. Less applicable to a
two-loco shuttle but very engaging for larger layouts with industries and
multi-stop routes.

### Fast clock display

Display "fast time" (a sped-up clock) on a small OLED or on the JMRI panel.
Useful if/when running scheduled trains or operations sessions.

### Build an EX-Turntable

The DCC-EX project has a kit/firmware for a microcontroller-driven
turntable. Excellent for a roundhouse-themed expansion.

## Custom EXRAIL automations to consider

- **Random station dwell only:** `DELAYRANDOM(min, max)` is safe at station
  stops. Do not randomize paired departures while S1/S2 are shared beams.
- **Time-of-day triggers:** different shuttle patterns at different fast-clock
  times (e.g. faster in "rush hour", slower at "night").
- **Conditional routing:** `IF(sensor)` -- "if a third sensor detects
  something, take the diverging route at the next turnout."
- **Inter-train coordination:** tokens or block reservations so multiple
  trains can run simultaneously without colliding.
- **Power districts:** if/when a MotorShield is added, separate booster
  control via `<1 MAIN>` / `<1 PROG>` / `<0>` to handle short circuits
  without tripping the whole layout.
