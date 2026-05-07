# Model Railroad Automation Project — Technical Handoff Document

> **Purpose of this document:** A comprehensive, self-contained reference for a sensor-driven two-train shuttle automation built on a DCC-EX EX-CSB1 command station with Azatrax RIR4 IR sensors bridged through an Arduino Uno. Written so that a future engineer (human or LLM) can pick up this project without prior context and extend it confidently.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Hardware Inventory and Materials](#3-hardware-inventory-and-materials)
4. [Layout Documentation](#4-layout-documentation)
5. [Software Stack and Key Technologies](#5-software-stack-and-key-technologies)
6. [Wiring Reference](#6-wiring-reference)
7. [Source Code](#7-source-code)
8. [Setup and Deployment Procedures](#8-setup-and-deployment-procedures)
9. [Common Operations Reference](#9-common-operations-reference)
10. [Lessons Learned: Mistakes and Nuances](#10-lessons-learned-mistakes-and-nuances)
11. [Troubleshooting Guide](#11-troubleshooting-guide)
12. [Future Expansion Possibilities](#12-future-expansion-possibilities)
13. [LLM-Specific Guidance for Future Sessions](#13-llm-specific-guidance-for-future-sessions)
14. [References and Resources](#14-references-and-resources)

---

## 1. Project Overview

### What this project does

A two-train alternating shuttle running on Kato Unitrack, fully automated via sensor detection. Trains run autonomously between two endpoints on a shared long track, taking turns via a single turnout that switches between their respective parking tracks at a station.

### Final operational behavior

1. Two trains (a Kato Shinkansen and Kato E233) are parked at a station on parallel tracks
2. A turnout (Turnout 2) selects which train enters the shared long track
3. On trigger, Train A (Shinkansen, address 2) runs out at speed 80 along the long track
4. When Train A reaches the far-end IR sensor, it slows to speed 40, creeps for 3 seconds, then stops for 10 seconds
5. Train A reverses at speed 80 back toward the station
6. When Train A reaches the home-end IR sensor, it slows, creeps, stops, pauses
7. Turnout switches to Train B's route
8. Train B (E233, address 4) does the same out-and-back cycle
9. The cycle repeats indefinitely (infinite loop)

### Project complexity context

This was not a turnkey integration. The Azatrax RIR4 was designed for 5V Arduino systems, but the EX-CSB1 is a 3.3V ESP32. Direct integration risks damaging the command station. The solution required a bridge architecture using an intermediate Arduino with level-shifted GPIO signals. This document captures that architecture and the lessons learned arriving at it.

---

## 2. System Architecture

### High-level flow

```
Physical IR Sensors (4 pairs at track positions)
            │
            ▼
       Azatrax RIR4 shield (5V, I2C slave to its onboard MCU)
            │
            ▼ I2C (5V, internal to the Arduino-RIR4 stack)
            │
       Arduino Uno R3 (5V) — runs custom sketch
       Reads RIR4 detector states via Azatrax library
       Mirrors states to GPIO output pins D4-D7
            │
            ▼ 4 digital signals (5V) + power references
            │
       BSS138 4-channel I2C-safe Logic Level Converter
       Translates 5V signals to 3.3V signals
            │
            ▼ 4 digital signals (3.3V)
            │
       EX-CSB1 GPIO inputs (IO33, IO26, IO16, IO17)
       DCC-EX firmware reads as standard sensor pins
            │
            ▼ DCC-EX network protocol
            │
       JMRI / WiThrottle / EXRAIL (sensors visible as 1001, 1002, etc.)
```

### Why this architecture (vs. alternatives considered)

| Approach considered | Why we didn't use it |
|---|---|
| Plug RIR4 directly onto CSB1 GPIO header | RIR4 is 5V; CSB1 is 3.3V. Risks ESP32 damage. CSB1 doesn't have Arduino-shield headers regardless. Confirmed empirically: WiFi died when stacked. |
| Connect RIR4 I2C to CSB1 I2C via level shifter | Two-master I2C bus problem (CSB1 and Arduino both want to be master). Plus DCC-EX has no Azatrax protocol driver. |
| Modify EX-IOExpander firmware on Arduino | Complex (Wire library dual master/slave issues), high risk, would require custom firmware maintenance |
| **GPIO mirror via Arduino** (chosen) | Arduino reads RIR4 over I2C natively; mirrors state to GPIO outputs; CSB1 reads simple digital inputs. No protocol bridging, no dual-mode I2C, level shifter is straightforward. |

---

## 3. Hardware Inventory and Materials

### Currently installed

| Item | Purpose | Notes |
|---|---|---|
| DCC-EX EX-CSB1 (bare, no MotorShield8874) | Command station | ESP32-based, 3.3V, dual track outputs integrated |
| Kato Unitrack | All track | Track wired with Kato Terminal Unijoiner from CSB1 MAIN output |
| Kato turnouts (Turnout 1, Turnout 2) | Track switches | DCC accessory addresses 1 and 2 |
| Proto Design Labs decoders (in turnouts) | Turnout decoders | Drop-in for Kato turnouts; address programming via magnetic method |
| Kato Shinkansen (loco) | Train A | DCC address 2; uses EM13 motor decoder |
| Kato E233 (loco) | Train B | DCC address 4; uses EM13 motor decoder |
| EM13 motor decoders | Kato motor decoders | Drop-in board for Kato locomotives |
| FR11 function decoders | Kato car lighting | Address programmed to match loco's address (so all lights respond to same throttle); F1 = interior lights |
| FL12 function decoders | Loco function-only decoder | If/when used with sound/lights in unpowered cabs |
| Azatrax RIR4 IR sensor shield | 4-channel IR detector with hardware speed-trap | I2C address 0x38 (per DIP switches); communicates internally with Arduino over I2C |
| 4× Azatrax IR sensor pairs | LED + phototransistor for each detector | Currently 2 of 4 channels in use |
| Arduino Uno R3 (or compatible clone) | Bridge microcontroller | ATmega328P, 5V, classic shield-compatible |
| Adafruit BSS138 4-channel I2C-safe Logic Level Converter | Voltage translation | ~$4. Adafruit product 757. Bidirectional, 4 channels. |
| Female-to-female and male-to-female jumper wires | Wiring | Need both types for various connections |
| OLED display (came with CSB1) | CSB1 status display | Plugs into CSB1's I2C female header; shows IP, firmware version, etc. |

### Tools needed for setup

- Soldering iron (~25-40W, fine tip), solder, sponge — for soldering pin headers to the BSS138 board
- USB-B cable — for programming the Arduino
- USB-C cable — for programming the CSB1
- Small flathead precision screwdriver (~2mm) — for RIR4 terminal screws
- Multimeter (optional but recommended for debugging)

### Where to buy

| Item | Source |
|---|---|
| DCC-EX EX-CSB1 | dcc-ex.com → Distributors page |
| Kato Unitrack, locos, turnouts | Kato dealers, hobby shops, Amazon |
| Proto Design Labs decoders | proto-design-labs.com |
| Azatrax RIR4 | azatrax.com |
| Arduino Uno R3 | arduino.cc (official ~$28) or Amazon (Elegoo/Keyestudio clones ~$10-15) |
| BSS138 Level Shifter | adafruit.com (#757), sparkfun.com (BOB-12009), or Amazon |
| Jumper wires | Amazon (40-piece mixed kit ~$5-7) |

---

## 4. Layout Documentation

### Track topology

```
                    Station
       ┌─────────────────────────┐
       │   Track A (Train 2/    │
       │   Shinkansen parks)    │
       └──────────┬──────────────┘
                  │
              [Turnout 2]
                  │
       ┌──────────┴──────────────┐
       │   Track B (Train 4/     │
       │   E233 parks)           │
       └─────────────────────────┘
                  │
                  ▼
              [Sensor 1001 (vpin 33) - "near end" of long track]
                  │
                  │  Long shared track
                  │  (lots of distance here)
                  │
              [Sensor 1002 (vpin 26) - "far end" of long track]
                  │
                  ▼
              (end of long track, no return loop)
```

### Sensor mapping

Two physical sensor pairs are installed (sensor 3 and 4 hardware are not yet wired to layout):

| Sensor ID (DCC-EX) | RIR4 Detector # | CSB1 vpin (GPIO) | Physical Position | EXRAIL Polarity Notes |
|---|---|---|---|---|
| 1001 | Detector 1 | 33 | Near end of long track (closer to station) | Use `AT(33)` (positive vpin = active HIGH) |
| 1002 | Detector 2 | 26 | Far end of long track | Use `AT(26)` (positive vpin = active HIGH) |
| 1003 | (Detector 3 - unused) | 16 | Not installed | reserved |
| 1004 | (Detector 4 - unused) | 17 | Not installed | reserved |

**Important polarity note:** The Arduino sketch was modified to drive GPIO outputs HIGH when *vacant* and LOW when *occupied*, but this combined with how DCC-EX `AT()` and JMRI sensor polarity handle the inversion ultimately required `AT(positive_vpin)` (without the negative sign). This was determined empirically—see Section 10.

### Turnout mapping

| Turnout ID (DCC-EX) | DCC Accessory Address | Position | Notes |
|---|---|---|---|
| 1 | 1 | (location TBD - currently unused in shuttle) | Reserved |
| 2 | 2 | At station, branches to Track A or Track B | **Thrown** = Train 2's route; **Closed** = Train 4's route |

### Train roster

| Train Name | DCC Address | Type | Decoders |
|---|---|---|---|
| KATO Shinkansen | 2 | Train A (runs first in shuttle) | EM13 motor + (any FR11 function decoders in cars set to address 2) |
| KATO E233 | 4 | Train B (runs second in shuttle) | EM13 motor + (any FR11 function decoders in cars set to address 4) |

### CSB1 GPIO pin allocation

Out of 13 visible IO pins on the CSB1 backside, only the 4 below are in use. Others are listed for future expansion reference.

| Pin | Status | Reservation Notes |
|---|---|---|
| IO33 | **In use** — Sensor 1001 input | Always free on bare CSB1 |
| IO26 | **In use** — Sensor 1002 input | Free without MotorShield; reserved if MotorShield stacked |
| IO16 | **In use** — Sensor 1003 input | Free without MotorShield; reserved if MotorShield stacked |
| IO17 | **In use** — Sensor 1004 input | Free without MotorShield; reserved if MotorShield stacked |
| IO04, IO05, IO13, IO18 | Available | Free without MotorShield; reserved if stacked |
| IO12 | Available with caveat | ESP32 strapping pin — affects boot if pulled high |
| IO36, IO39 | Available, input-only | Free without MotorShield; cannot drive outputs |
| IO01, IO03 | **DO NOT USE** | UART0 — reserved for USB serial debugging |
| IO21, IO22 | **DO NOT USE** | I2C bus (OLED, future I2C accessories) |
| IO32 | **DO NOT USE** | Documented as Booster Input |

---

## 5. Software Stack and Key Technologies

### DCC-EX

Open-source DCC command station firmware running on the EX-CSB1. Provides:
- DCC track signal generation and motor control
- WiFi networking (CSB1 acts as Access Point or joins WiFi network)
- Throttle protocol (WiThrottle) for mobile apps and JMRI
- EXRAIL automation language built into the firmware
- Sensor/turnout/output management

Currently running version: **5.6.0-Prod** (build master-202605011818Z)

### EXRAIL

DCC-EX's built-in automation scripting language. Lives in `myAutomation.h` and is compiled into the firmware. Supports:
- Routes (button-triggered command sequences)
- Automations (loco-attached scripts)
- Sequences (private sub-routines)
- Sensor waits, turnout control, loco control, conditionals, delays

EXRAIL key concept: **the same numeric ID space is used differently per object type.** Routes, Automations, Sequences, Sensors, and Turnouts each have their own ID namespace.

EXRAIL key gotcha: **`AT(vpin)` operates on vpin numbers, not sensor IDs.** Even if your sensor is configured as "Sensor 1001 on vpin 33," `AT(1001)` waits for vpin 1001 (which doesn't exist) — you must use `AT(33)`. Negative vpin (`AT(-33)`) inverts polarity to active-low.

### JMRI (Java Model Railroad Interface)

Cross-platform desktop application (Windows/Mac/Linux) for controlling and managing model railroads. Connects to DCC-EX over WiFi or USB.

Components used:
- **PanelPro / DecoderPro** — same application, different launcher icons
- **Sensor/Turnout/Roster Tables** — for managing layout objects
- **Throttle window** — for direct loco control
- **Traffic Monitor** — diagnostic tool showing all DCC-EX commands flowing in/out
- **Send DCC++ Command** — sends raw DCC-EX commands

JMRI installation: jmri.org

### Arduino IDE

Used to program the Arduino Uno bridge. Required for Azatrax library installation and uploading the GPIO mirror sketch.

### Azatrax Arduino Library

Provided by Azatrax for communicating with their RIR4 shield. Wraps the RIR4's custom I2C register protocol into easy function calls.

Key classes/methods:
- `Azatrax RIR4(0x38)` — instantiate with I2C address (set by DIP switches)
- `RIR4.getDetData(0x00)` — read register 0x00, returns 4-bit detector state bitmap
- `RIR4.detOccupied(n)` — boolean, returns true if detector n is occupied
- `RIR4.detVacant(n)` — boolean, opposite of detOccupied
- `RIR4.getSignalLevel(n)`, `RIR4.getThreshold(n)`, `RIR4.getAmbient(n)` — diagnostics
- `RIR4.setThreshold(n, value)` — adjust detector sensitivity

Library download: azatrax.com → RIR4 product page → AzatraxArduinoLib zip

### EX-Installer

Cross-platform GUI tool (Windows/Mac/Linux) for installing DCC-EX firmware on the CSB1. Handles compilation, configuration via myConfig.h, and uploading. Available at dcc-ex.com → Downloads.

---

## 6. Wiring Reference

### Arduino + RIR4 stack (the sensor-reading side)

The RIR4 plugs directly onto the Arduino's shield headers. Arduino is in control; RIR4 is mounted on the layout and is essentially a stationary piece of hardware. Arduino can be removed/reinstalled for programming.

The RIR4 has stackable female headers on top — used here as the connection point for jumper wires.

### Sensor pair wiring (RIR4 terminal blocks)

For each IR sensor pair (LED + phototransistor):

| Wire color (from sensor) | Connects to RIR4 terminal |
|---|---|
| Orange/red (from clear LED) | nK (where n is detector number 1-4) |
| Green/blue (from dark receiver) | nF |
| White (across-track mode) | X (common) |
| Yellow | the other common terminal |

### Bridge wiring: Arduino + RIR4 → BSS138 Level Shifter → CSB1

**HV side of level shifter (5V Arduino side) — 6 male-to-female jumper wires**

| Wire | From: RIR4 socket label | To: BSS138 HV side pin |
|---|---|---|
| Power | 5V (Power row) | HV |
| Ground | GND (Power row) | GND (HV side) |
| Detector 1 signal | D4 (Digital row) | A1 |
| Detector 2 signal | D5 (Digital row) | A2 |
| Detector 3 signal | D6 (Digital row) | A3 |
| Detector 4 signal | D7 (Digital row) | A4 |

**LV side of level shifter (3.3V CSB1 side) — 6 female-to-female jumper wires**

| Wire | From: BSS138 LV side pin | To: CSB1 GPIO header label |
|---|---|---|
| Power | LV | 3V3 (or "+") |
| Ground | GND (LV side) | G (any GND) |
| Detector 1 signal | B1 | IO33 |
| Detector 2 signal | B2 | IO26 |
| Detector 3 signal | B3 | IO16 |
| Detector 4 signal | B4 | IO17 |

**Total: 12 wires (6 on each side of the level shifter)**

### Track power wiring

CSB1's MAIN output → Kato Terminal Unijoiner → injected into track at one location. Polarity is not critical (DCC is symmetric), but must be consistent across all feeders if multiple are used.

Per Kato manufacturer docs, one terminal feeder is sufficient for small layouts (<8 feet of total track). Add feeders every ~6-8 feet for larger layouts.

For #4 power-routing turnouts: set the underside switch to "non-power-routing" position for reliable DCC operation.

### Arduino power

The Arduino must be powered when in operation. Options:
- USB-B from a phone charger (5V via USB)
- USB-B from a computer (5V via USB, also enables Serial Monitor)
- 7-12V DC into the barrel jack (regulated to 5V internally)

Do **not** feed >5V into the USB or 5V pin.

The Arduino in turn powers the RIR4 via the shield headers (RIR4 takes 5V from Arduino's pin).

---

## 7. Source Code

### Arduino sketch: GPIO Mirror

**File:** Save as `RIR4_GPIO_Mirror.ino` or similar.
**Target:** Arduino Uno R3 (ATmega328P, 5V).
**Required library:** AzatraxArduinoLib (install via Arduino IDE → Sketch → Include Library → Add .ZIP Library).

```cpp
/*
 * RIR4 to GPIO Mirror
 *
 * Reads Azatrax RIR4 IR detectors via I2C and mirrors their states
 * to four digital output pins. Drives pin LOW when detector is
 * occupied, HIGH when vacant. (Polarity convention determined
 * empirically to match DCC-EX AT() expectations.)
 *
 * Pin mapping:
 *   Detector 1 -> D4
 *   Detector 2 -> D5
 *   Detector 3 -> D6
 *   Detector 4 -> D7
 *
 * Polls the RIR4 every 50ms.
 */

#include <Azatrax.h>

// Match the I2C address set by your RIR4 DIP switches
Azatrax RIR4(0x38);

// Output pins for each detector's mirrored state
const uint8_t OUTPUT_PINS[4] = {4, 5, 6, 7};

// How often to poll the RIR4 (milliseconds)
const unsigned long POLL_INTERVAL = 50;

unsigned long lastPoll = 0;

void setup() {
  Serial.begin(9600);
  Serial.println("RIR4 GPIO Mirror starting...");

  for (uint8_t i = 0; i < 4; i++) {
    pinMode(OUTPUT_PINS[i], OUTPUT);
    digitalWrite(OUTPUT_PINS[i], LOW);
  }

  Serial.println("Output pins configured. Polling RIR4...");
}

void loop() {
  if (millis() - lastPoll < POLL_INTERVAL) {
    return;
  }
  lastPoll = millis();

  byte detectorBitmap = RIR4.getDetData(0x00);

  if (detectorBitmap == 0xFF) {
    Serial.println("WARN: RIR4 did not respond as expected");
    return;
  }

  // Drive LOW when occupied, HIGH when vacant.
  // This polarity was empirically determined to match the
  // EXRAIL AT(positive_vpin) behavior on the CSB1 side.
  for (uint8_t i = 0; i < 4; i++) {
    bool occupied = (detectorBitmap >> i) & 0x01;
    digitalWrite(OUTPUT_PINS[i], occupied ? LOW : HIGH);
  }

  // Diagnostic output: print state on change
  static byte lastBitmap = 0xFF;
  if (detectorBitmap != lastBitmap) {
    Serial.print("Detectors: ");
    for (int8_t i = 3; i >= 0; i--) {
      Serial.print(((detectorBitmap >> i) & 0x01) ? "X" : ".");
    }
    Serial.println();
    lastBitmap = detectorBitmap;
  }
}
```

### DCC-EX `myAutomation.h`: Sensor-driven shuttle

**File:** Lives in the CommandStation-EX project folder. Modified by EX-Installer.
**Target:** EX-CommandStation v5.6.0-Prod on EX-CSB1.

```cpp
// myAutomation.h - Sensor-driven two-train alternating shuttle (infinite loop)
//
// HARDWARE:
//   Loco 2 = Shinkansen (Train A, runs first)
//   Loco 4 = E233 (Train B, runs second)
//   Turnout 2: thrown = Train 2's route, closed = Train 4's route
//   Sensor 1001 (vpin 33) = near end of long track (close to station)
//   Sensor 1002 (vpin 26) = far end of long track
//
// BEHAVIOR:
//   1. Trigger: </START 100>
//   2. Train 2 runs out at speed 80, slows to 40 at far sensor, creeps 3s,
//      stops 10s, reverses at 80, slows at home sensor, stops 10s
//   3. Turnout switches; Train 4 does the same out-and-back
//   4. Loops infinitely until killed
//
// STOP COMMANDS:
//   </KILL ALL>      - terminate all running EXRAIL tasks
//   <!>              - emergency stop all locos
//   </PAUSE>         - pause everything (resume with </RESUME>)
//
// SENSOR CONFIGURATION (must be sent after each flash via JMRI command sender):
//   <S 1001 33 0>
//   <S 1002 26 0>

// ---- Roster (loco names for WiThrottle) ----
ROSTER(2, "KATO Shinkansen", "F0/F1/F2")
ROSTER(4, "KATO E233", "F0/F1/F2")

// ---- Turnouts ----
TURNOUTL(1, 1, "KATO Turnout 1")
TURNOUTL(2, 2, "KATO Turnout 2")

// ---- Boot-time setup: power on the track ----
AUTOSTART
POWERON
DONE

// ---- Trigger route: dispatches Train 2 to Sequence 10 ----
ROUTE(100, "Start Shuttle")
  SENDLOCO(2, 10)
DONE

// ---- Train 2 (Shinkansen) sequence: turnout thrown ----
SEQUENCE(10)
  THROW(2)
  DELAY(2000)
  FWD(80)
  AT(26)              // wait for vpin 26 (sensor 1002 - far end)
  FWD(40)
  DELAY(3000)         // creep for 3 seconds
  STOP
  DELAY(10000)
  REV(80)
  AT(33)              // wait for vpin 33 (sensor 1001 - home end)
  REV(40)
  DELAY(3000)
  STOP
  DELAY(10000)
  SENDLOCO(4, 20)     // dispatch Train 4
DONE

// ---- Train 4 (E233) sequence: turnout closed ----
SEQUENCE(20)
  CLOSE(2)
  DELAY(2000)
  FWD(80)
  AT(26)
  FWD(40)
  DELAY(3000)
  STOP
  DELAY(10000)
  REV(80)
  AT(33)
  REV(40)
  DELAY(3000)
  STOP
  DELAY(10000)
  SENDLOCO(2, 10)     // dispatch Train 2 again - infinite loop
DONE
```

### Sensor configuration commands (runtime, via JMRI command sender)

These must be re-sent after each firmware flash, since EXRAIL doesn't support `SENSOR()` declaration in this version (5.6.0):

```
<S 1001 33 0>
<S 1002 26 0>
```

Optionally, also configure the unused sensor IDs:

```
<S 1003 16 0>
<S 1004 17 0>
```

Verify with `<S>` (uppercase). Should return four lines listing each sensor's pin and pullup.

---

## 8. Setup and Deployment Procedures

### Initial setup from scratch (assuming all hardware is already purchased)

1. **CSB1 Firmware Setup**
   - Download EX-Installer from dcc-ex.com → Downloads
   - On Mac: download .dmg, drag EX-Installer.app to Applications, right-click → Open the first time to bypass Gatekeeper
   - Connect CSB1 to computer via USB-C
   - Note: macOS exposes Bluetooth devices as serial ports; verify you're picking the actual CSB1 port, not a random Bluetooth device
   - Use EX-Installer to flash CommandStation-EX with myAutomation.h content from Section 7
   - WiFi configuration: choose AP mode (CSB1 creates own network) or Station mode (joins your home WiFi)

2. **Arduino + RIR4 Setup**
   - Install Arduino IDE (arduino.cc/en/software)
   - Install Azatrax library: download zip from azatrax.com, IDE → Sketch → Include Library → Add .ZIP Library
   - Set RIR4 DIP switches for I2C address 0x38 (or whichever address you prefer; just match it in the sketch)
   - Wire IR sensor pairs to RIR4 terminal blocks (see Section 6)
   - Plug Arduino onto RIR4 shield headers
   - Connect Arduino to computer via USB-B
   - Upload `RIR4_GPIO_Mirror.ino` (Section 7) to Arduino
   - Open Serial Monitor (9600 baud) and verify "Detectors: ...." output
   - Test by waving hand at each sensor pair; confirm "X" appears for the correct detector

3. **Level Shifter Setup**
   - Solder 0.1" pin headers to BSS138 board (12 joints total, 6 per side)
   - Verify joints visually: shiny, conical, no bridges

4. **Bridge Wiring**
   - Power down everything
   - Connect Arduino+RIR4 → BSS138 (HV side) using 6 male-to-female jumper wires per Section 6
   - Connect BSS138 (LV side) → CSB1 GPIO header using 6 female-to-female jumper wires per Section 6
   - Triple-check polarity before powering on (5V to HV, 3.3V to LV, never cross)
   - Power Arduino first, then CSB1
   - Verify nothing overheats

5. **JMRI Setup**
   - Install JMRI from jmri.org
   - Edit → Preferences → Connections → Add new DCC-EX or DCC++ over Network connection
   - Set CSB1's IP address (shown on OLED at boot, or 192.168.4.1 in AP mode), port 2560
   - Save and restart JMRI
   - Verify by opening a throttle and confirming you can control a loco

6. **Sensor Configuration**
   - Open JMRI's Send DCC++ Command window
   - Send: `<S 1001 33 0>` and `<S 1002 26 0>` (and optionally 1003/1004)
   - Verify with `<S>` — should list all configured sensors

7. **First Test of Shuttle**
   - Position both trains at station (parallel tracks)
   - Verify trains can move: `<t 2 30 1>` (Shinkansen) and `<t 4 30 1>` (E233), then `<t 2 0 1>` and `<t 4 0 1>` to stop
   - Verify sensors trigger: open JMRI Sensor Table, wave hand at each sensor, confirm 1001 and 1002 toggle
   - Trigger shuttle: `</START 100>` in command sender
   - Watch trains complete a full cycle
   - To stop: `</KILL ALL>` then `<!>`

### When re-flashing the CSB1 firmware

1. Edit `myAutomation.h` with desired changes
2. Use EX-Installer to flash (USB-C connection required, one time)
3. **After flash:** re-send sensor configuration commands (`<S 1001 33 0>` and `<S 1002 26 0>`)
4. Verify configuration: `<S>` (should list sensors) and `<JA>` (should list automations/routes)

### When updating the Arduino sketch

1. Disconnect Arduino from RIR4 (or use long USB cable to layout)
2. Connect Arduino to computer via USB-B
3. Edit and upload sketch from Arduino IDE
4. Verify with Serial Monitor before reattaching to layout
5. Reattach Arduino to RIR4

---

## 9. Common Operations Reference

### Triggering and stopping the shuttle

| Action | Command (in JMRI command sender, EX-WebThrottle, or telnet to port 2560) |
|---|---|
| Start shuttle (one cycle, since it now infinite-loops, will keep going) | `</START 100>` |
| Stop all running scripts immediately | `</KILL ALL>` |
| Emergency stop all locos | `<!>` |
| Pause everything (resumable) | `</PAUSE>` |
| Resume after pause | `</RESUME>` |
| Track power off | `<0>` |
| Track power on | `<1>` |

### Diagnostics

| Question | Command |
|---|---|
| Is DCC-EX alive and what version? | `<s>` (lowercase) |
| What sensors are configured? | `<S>` (uppercase) |
| What automations/routes are loaded? | `<JA>` |
| What's on the I2C bus? | `<D I2C>` |
| What turnouts are configured? | `<T>` |
| Manually test a loco | `<t addr speed dir>` e.g., `<t 2 50 1>` (loco 2, speed 50, forward) |
| Manually test a turnout | `<T addr 1>` (throw) or `<T addr 0>` (close) |
| Force a sensor active (testing) | `<s sensor_id 1>` (lowercase s) |

### JMRI tasks

- **View all sensors:** Tools → Tables → Sensors
- **View all turnouts:** Tools → Tables → Turnouts
- **View loco roster:** Tools → Tables → Roster
- **Open throttle:** Tools → Throttle
- **Send raw command:** DCC-EX menu (or DCC++) → Send DCC++ Command
- **Watch all traffic:** DCC-EX menu → Traffic Monitor

---

## 10. Lessons Learned: Mistakes and Nuances

This section is opinionated and honest. It records the pitfalls and false starts so you don't repeat them.

### DO's

- **Always check voltage compatibility before plugging anything into the CSB1.** ESP32-based boards are 3.3V; many Arduino accessories are 5V. Mismatch can damage the ESP32. The level shifter is mandatory for any 5V signal source.
- **Use Kato Terminal Unijoiners for track power.** Simple, reliable, and Kato-approved.
- **For Kato #4 turnouts, set the underside screw to "non-power-routing"** for DCC operation.
- **Set up an isolated programming track using plastic Unijoiners** for safer decoder programming.
- **Back up `myAutomation.h` before any flash** — EX-Installer can sometimes overwrite it.
- **Re-send sensor configuration commands after every CSB1 flash** — they don't always persist through firmware updates in version 5.6.0.
- **Test components individually before integration.** Verify Arduino+RIR4 standalone first, then add the bridge, then add the CSB1 side. Easier to debug each layer.
- **Solder pin headers in a specific order:** first pin, last pin, then middle pins. Lets you correct alignment before all pins are committed.
- **Inspect every solder joint visually** — shiny, cone-shaped, no bridges, no dull cold joints.
- **Use the Traffic Monitor in JMRI** to see exactly what commands flow between JMRI and DCC-EX. Most issues become obvious there.
- **Search the DCC-EX Discord** before writing custom integrations — many edge cases have community solutions.
- **Use the runtime `<S>` command for sensor configuration** rather than EXRAIL `SENSOR()` macros (which don't exist in v5.6.0).

### DON'Ts

- **Don't plug a 5V Arduino shield directly onto the CSB1's I2C lines.** Risks ESP32 damage. (We confirmed this empirically: WiFi died.)
- **Don't assume EXRAIL `SENSOR()`, `EXIOExpander HAL()`, or other macros exist** — verify against your specific DCC-EX version's documentation. Many AI-suggested EXRAIL syntax variants are wrong.
- **Don't use `AT(sensor_id)`** — `AT()` takes a vpin number, not a sensor ID. They're often the same in tutorials but different here (e.g., sensor 1001 is on vpin 33, so use `AT(33)`).
- **Don't use IO01, IO03 on the CSB1.** They're UART0 (USB serial debugging).
- **Don't use IO32 on the CSB1.** Reserved for booster input.
- **Don't power the Arduino's 5V pin directly with 9V or higher.** Skips the regulator and destroys the chip.
- **Don't run multiple DCC-EX commands without waiting for responses.** Especially `<S>` configuration — wait for `<O>` before sending the next.
- **Don't attempt to make the Arduino simultaneously be an I2C master (to RIR4) and slave (to CSB1) with EX-IOExpander.** This was attempted and abandoned due to dual-master issues. Use the GPIO mirror approach instead.
- **Don't trust LLM-generated EXRAIL scripts blindly.** The DCC-EX docs explicitly warn that AI assistants get EXRAIL wrong frequently. Always cross-reference against the official command reference.
- **Don't connect a non-DCC accessory to track power.** Use separate 5V/3.3V supplies for electronics.

### Major mistakes we made along the way (and what fixed them)

1. **Initial attempt: stack RIR4 directly on CSB1 GPIO headers.** Result: WiFi died. Cause: 5V vs 3.3V incompatibility. **Fix:** GPIO mirror architecture with level shifter.

2. **Used `SENSOR(id, vpin, pullup)` macro in `myAutomation.h`.** Result: compilation failed with "SENSOR was not declared in this scope." Cause: That macro doesn't exist in v5.6.0. **Fix:** Configure sensors at runtime with `<S>` commands instead.

3. **Used `AT(1001)` to wait for sensor 1001.** Result: Train didn't react when sensor triggered. Cause: `AT()` operates on vpin numbers, not sensor IDs. **Fix:** Use `AT(33)` (the actual vpin for that sensor).

4. **Tried `AT(-vpin)` for inverted polarity.** Result: Worked but was wrong choice. **Fix:** After Arduino sketch was modified to drive pins LOW when occupied, polarity logic interaction with DCC-EX/JMRI required `AT(positive_vpin)` instead. This was determined empirically — when in doubt, test both.

5. **Set cruise speed to 100 (full speed).** Result: Train overshot sensors at high speed; missed detection or coasted past stopping point. **Fix:** Reduced to 80, with 3-second creep at speed 40.

6. **Confused the "Send DCC++ Command" window with the Traffic Monitor.** Result: Sent commands but didn't see responses. **Fix:** Use the Traffic Monitor for both sending and viewing responses.

7. **Initial Arduino sketch had wrong polarity.** Result: JMRI showed sensors as Active when no train present, Inactive when train present. **Fix:** Inverted the GPIO logic in the sketch (`HIGH` ↔ `LOW`).

8. **Mac's Bluetooth devices appeared as serial ports.** Result: EX-Installer connected to wrong port. **Fix:** Carefully verify the correct port — unplug CSB1, see which port disappears, reconnect.

9. **Tried to integrate via EX-IOExpander.** Result: Concept was sound but execution had I2C dual-master complications. **Fix:** Pivoted to GPIO mirror approach, which is simpler and more robust.

### Subtle nuances

- **Forward/reverse depends on physical loco orientation.** `FWD` doesn't mean "away from station" — it means "the direction the loco's decoder considers forward." If your trains move the wrong way, physically turn the loco around rather than swapping FWD/REV in the script.

- **CV3/CV4 (acceleration/deceleration) momentum on decoders affects stopping distance.** High momentum = trains coast a long way after STOP. For automation, lower values (5-10) give more predictable stops.

- **The OLED on the CSB1 lives on the same I2C bus as anything you connect via the level shifter.** This is fine — multiple devices coexist on I2C — but be aware of address conflicts.

- **Sensor polarity has multiple inversions in the chain:** RIR4 register bit (occupied=1), Arduino sketch (drives LOW when occupied), level shifter (passes through), CSB1 read (active high or low based on `AT()` polarity). Trust empirical testing over derived logic; the chain has too many places for sign errors.

- **EXRAIL routes appear as turnouts in JMRI's Turnout Table** (not the Routes Table). Confusing terminology, but standard.

- **Re-flashing the firmware in EX-Installer can wipe `myAutomation.h`.** Always keep a backup outside the project folder.

- **The DCC-EX team's project documentation explicitly warns that AI assistants get EXRAIL wrong frequently.** Don't trust LLM-generated EXRAIL syntax without verification.

---

## 11. Troubleshooting Guide

### Trains don't move at all

1. Check track power: `<s>` should show `<p1 MAIN>`. If `<p0>`, send `<1>` to power on.
2. Verify loco responds manually: `<t 2 30 1>` should make Train 2 move forward.
3. Verify track is wired correctly to MAIN output, not just PROG.
4. Try a different loco — if both fail, it's a track/power issue. If one works, that loco's decoder may need attention.

### Sensors don't trigger in JMRI

1. Verify Arduino is powered: blue LED on RIR4 should be on.
2. Verify Arduino sketch is running: USB to computer, Serial Monitor at 9600 baud, wave hand → "Detectors: X" output.
3. Verify level shifter wiring: 5V to HV, 3.3V to LV, A1↔B1 paired, A2↔B2 paired, common GNDs.
4. Verify sensor configured in DCC-EX: `<S>` should list each sensor with correct vpin.
5. Verify with multimeter: probe between CSB1 IO33 and GND. Should swing between ~0V and ~3.3V as you trigger detector 1.

### EXRAIL `AT()` doesn't react

1. Verify the vpin number, not the sensor ID, is in `AT()`. If sensor 1001 is on vpin 33, use `AT(33)`.
2. Check polarity: try both `AT(33)` and `AT(-33)`. Empirically determine which matches your sketch's drive logic.
3. Verify sensor toggles in JMRI's Sensor Table when triggered. If it doesn't, the issue is upstream of EXRAIL.
4. Verify `<JA>` lists your automation/sequence/route IDs.

### Trains overshoot stopping points

1. Reduce cruise speed (lower number in `FWD()`).
2. Reduce slowdown duration (lower number in `DELAY()` after slowdown).
3. Reduce decoder momentum: in DecoderPro, lower CV3 (acceleration) and CV4 (deceleration) on the locos.
4. Move sensors physically further from the desired stop point so trains have more room to slow.

### Compilation fails when flashing

1. Read the error carefully — EXRAIL errors often point to lines deep in framework code but the real issue is in your `myAutomation.h`.
2. Common issues:
   - Used `SENSOR()` macro (doesn't exist in 5.6.0) — use runtime `<S>` commands instead
   - Missing `DONE` at end of a sequence
   - Mismatched parentheses
   - Stray characters
3. If stuck, post on DCC-EX Discord with the script and error.

### Can't connect to CSB1 from JMRI

1. Verify CSB1 is on (OLED shows status).
2. Verify computer is on same WiFi network as CSB1.
3. Find CSB1's IP — shown on OLED at boot, or check router DHCP list.
4. Check JMRI Preferences → Connections → IP and port (2560) match.
5. Try `ping <csb1-ip>` from terminal — if ping fails, network issue. If ping works, JMRI config issue.
6. Restart JMRI fully (close all windows, relaunch).

### Train moves but turnout doesn't switch

1. Verify turnout has DCC accessory decoder installed (Proto Design Labs or similar).
2. Test manually: `<T 2 1>` should throw, `<T 2 0>` should close.
3. If no audible click, the decoder may have a different address — verify with `<T>` to list known turnouts.
4. PDL decoders use magnetic programming — re-program with magnet if address is wrong.

---

## 12. Future Expansion Possibilities

### Short-term enhancements (with current hardware)

- **Wire sensors 3 and 4** (currently unused). Existing Arduino sketch already handles all 4 detectors; just need to install IR pairs at desired track positions and update `myAutomation.h` to use them.
- **Add headlight automation:** insert `FON(0)` (turn on F0) at start of each sequence, `FOFF(0)` at end, for prototypical lighting behavior.
- **Add a graceful stop:** introduce a virtual flag sensor (e.g., 2001) that checks between train dispatches, allowing a "Stop Shuttle" route that takes effect after the current train finishes rather than mid-cycle.
- **Add station sounds** if your locos have sound decoders (FON(2) for horn, etc.).
- **Tune decoder speed tables** so both trains run at consistent speeds at the same throttle setting (CV5 max, CV6 mid).

### Medium-term enhancements (small hardware additions)

- **Add EX-MotorShield8874** for a second power district (if needed). Note: this consumes most spare GPIO pins; would require pivoting sensors to MCP23017 I2C GPIO expander.
- **Add MCP23017 GPIO expander** ($5, plugs into CSB1's I2C Qwiic connector) for many more sensor inputs without using CSB1 GPIO.
- **Add accessory decoders for DCC-controlled turnouts** if expanding the layout with more switches.
- **Add additional Azatrax detectors** — the RIR4 supports up to 4 channels, and you can stack up to 8 RIR4 boards on one Arduino with unique I2C addresses.
- **Add LED signals** at the station and far end of long track. Drive from CSB1 GPIO outputs (or via I2C expander) and control via EXRAIL.

### Long-term enhancements

- **Multi-block detection** for prototypical signaling systems (ABS/APB).
- **JMRI Dispatcher** for full CTC-style operation with multiple trains and complex routing.
- **JMRI Operations** for prototypical freight switching games.
- **Add servos for Kato turnout motorization** (Kato turnouts are typically solenoid-driven, but servo conversion is a hobby option).
- **Build an EX-Turntable** if adding a turntable to the layout.
- **Add fast clock display** for operating sessions.

### Custom EXRAIL automations to consider

- Random departure delays: `DELAYRANDOM(min, max)` for less mechanical-feeling shuttle timing
- Time-of-day triggers: run different shuttle patterns at different fast-clock times
- Conditional logic: `IF(sensor)` for "if a third sensor detects something, take the diverging route"
- Inter-train coordination: tokens/blocks for multiple trains running simultaneously without collisions

---

## 13. LLM-Specific Guidance for Future Sessions

If you're an LLM picking up this project to help the user extend it, please keep the following in mind. These are lessons learned from the original project's chat history.

### Your knowledge of EXRAIL is likely outdated or incomplete

The DCC-EX project documentation explicitly warns:

> "Do not waste your time asking ChatGPT, Copilot or Gemini to create EXRAIL scripts. They do not understand EXRAIL and will get it wrong 100% of the time."

This is accurate in our experience. EXRAIL syntax has changed across versions, the macro system is non-obvious, and many tutorials reference outdated forms. **Always cross-reference against the current EXRAIL command reference at dcc-ex.com before suggesting EXRAIL code.**

Specifically verify the existence of any macro before suggesting it:
- Some don't exist in all versions (e.g., `SENSOR()` doesn't exist in 5.6.0)
- Some take vpin numbers, not sensor/object IDs (e.g., `AT(vpin)`, `IF(vpin)`)
- Negative numbers often invert polarity (e.g., `AT(-vpin)`)

### Never assume DCC-EX command syntax

Always verify with the user via documentation lookup before suggesting:
- `<>` commands (the DCC-EX native protocol)
- EXRAIL macros
- HAL declarations

When unsure, recommend the user check the DCC-EX docs or Discord, and offer to help debug the actual error message rather than guess.

### Voltage and electrical compatibility is critical

Before suggesting any new hardware integration:
1. Confirm voltage compatibility (3.3V CSB1 vs 5V many accessories)
2. Recommend a level shifter if voltages differ
3. Don't suggest plugging 5V devices directly to CSB1 GPIO without level shifting

### The system is multi-layered

A change in one layer can have non-obvious effects elsewhere. The chain is:
**Physical sensor → RIR4 register → I2C → Azatrax library → Arduino sketch → GPIO output → level shifter → CSB1 GPIO input → DCC-EX sensor → JMRI sensor → EXRAIL script**

When debugging "the sensor doesn't work," diagnose layer by layer. Don't skip ahead.

### Empirical testing beats derivation

The original project had multiple polarity inversions in the chain that made theoretical reasoning unreliable. When uncertain about polarity, drive direction, sensor logic, etc., test both options and let the user observe which works.

### The hardware project is built and stable; software is the iteration target

The user's hardware is wired and working. Don't suggest hardware changes unless necessary. Focus changes on:
- Arduino sketch (re-uploadable easily)
- `myAutomation.h` (re-flashable, but takes ~5 min)
- Runtime DCC-EX commands (immediate, no re-flash needed)
- JMRI configuration (immediate)

### Be honest about uncertainty

If you're not 100% sure of EXRAIL syntax, network behavior, library API, etc., **say so**. Recommend verification. Don't fabricate plausible-looking syntax. The user's project is already complex; wrong information costs them debugging time.

### Specifically, avoid these patterns from the original project

- Suggesting `SENSOR()` macro in EXRAIL → it doesn't exist in 5.6.0
- Suggesting `AT(sensor_id)` → use `AT(vpin)` instead
- Suggesting `EXIOExpander HAL()` integration with the RIR4 → the I2C dual-master problem makes this impractical
- Confidently asserting EXRAIL behavior → always check the current command reference

### Where to verify

- **EXRAIL command reference:** https://dcc-ex.com/exrail/exrail-command-reference.html
- **DCC-EX native commands:** https://dcc-ex.com/reference/software/command-summary-consolidated.html
- **DCC-EX Discord:** https://discord.gg/dcc-ex (high signal-to-noise; community knows EXRAIL idioms)
- **DCC-EX GitHub:** https://github.com/DCC-EX/CommandStation-EX (source of truth for current behavior)
- **JMRI documentation:** https://www.jmri.org/help/en/

### Recommended workflow for the user

When the user wants to make a change:
1. Identify the smallest layer that can be changed (DCC-EX command > sketch > JMRI > Arduino reflash > CSB1 reflash)
2. Suggest a test plan that validates the change at each layer
3. Provide the exact code/command needed
4. Provide a backup/restore plan in case it doesn't work
5. After they apply the change, ask for specific feedback (what worked, what didn't, exact error messages)

---

## 14. References and Resources

### Documentation

- **DCC-EX main site:** https://dcc-ex.com
- **DCC-EX EXRAIL reference:** https://dcc-ex.com/exrail/exrail-command-reference.html
- **DCC-EX native commands:** https://dcc-ex.com/reference/software/command-summary-consolidated.html
- **JMRI:** https://www.jmri.org
- **Azatrax:** https://www.azatrax.com (RIR4 product page has user guide PDF and library download)
- **Arduino:** https://www.arduino.cc

### Community

- **DCC-EX Discord:** https://discord.gg/dcc-ex (active, helpful community)
- **JMRI Groups.io:** https://groups.io/g/jmriusers
- **r/modeltrains** on Reddit
- **NMRA forums** (National Model Railroad Association)

### Source code repositories

- **CommandStation-EX firmware:** https://github.com/DCC-EX/CommandStation-EX
- **EX-Installer:** https://github.com/DCC-EX/EX-Installer
- **EX-IOExpander:** https://github.com/DCC-EX/EX-IOExpander (referenced but not used in this project)

### Hardware sources

- **Adafruit BSS138 Level Shifter:** https://www.adafruit.com/product/757
- **Arduino Uno R3:** https://store.arduino.cc/products/arduino-uno-rev3
- **DCC-EX EX-CSB1:** Distributors listed at https://dcc-ex.com (varies by region)

---

## Appendix A: Project Glossary

- **AVR:** The microcontroller architecture used in classic Arduinos (ATmega chips). 5V logic.
- **ESP32:** Modern microcontroller from Espressif Systems with built-in WiFi/Bluetooth. 3.3V logic. Used in the EX-CSB1.
- **DCC:** Digital Command Control — the standard digital protocol for model railroad control.
- **NMRA:** National Model Railroad Association, the standards body for DCC.
- **EXRAIL:** "EX Railroad Automation Instruction Language" — DCC-EX's built-in scripting language for automation.
- **HAL:** Hardware Abstraction Layer — DCC-EX's mechanism for supporting different I/O devices.
- **vpin:** "Virtual pin" — DCC-EX's internal numbering for I/O pins (covers both physical pins on the command station and virtual pins on accessory boards).
- **Throttle:** A device or app that controls trains via DCC. Includes WiThrottle apps, JMRI's throttle window, physical hand controllers.
- **Roster:** A list of locomotives with their addresses and metadata.
- **Frog:** The X-shaped crossing point of a turnout.
- **Power-routing turnout:** A turnout that only powers the rails along the selected route. Can cause DCC issues; usually disabled.
- **Reverse loop:** A track configuration where a train can reverse direction without stopping. Requires special wiring/electronics for DCC.
- **Block:** An electrically isolated section of track, used for occupancy detection.
- **EM13:** Kato's drop-in motor decoder for their N-scale locos.
- **FR11:** Kato's function decoder for passenger cars (lighting).
- **FL12:** Kato's function decoder for unpowered locomotive units.

---

## Appendix B: Project Status as of Handoff

**Build status:** Operational. Two-train sensor-driven shuttle running infinite loops successfully.

**Outstanding issues / known limitations:**
- Sensors 3 and 4 are wired electrically but not mounted to track positions.
- No graceful "stop after current cycle" — only `</KILL ALL>` immediate stop.
- Sensor configuration must be re-sent after each firmware flash (a minor inconvenience).
- High speeds (>80) cause trains to overshoot stopping points.

**Last tested configuration:**
- DCC-EX: v5.6.0-Prod (build master-202605011818Z)
- JMRI: (whichever version was current at last test)
- Arduino sketch: GPIO Mirror v1, polling interval 50ms
- Cruise speed: 80, Slowdown speed: 40, Slowdown duration: 3 seconds
- Run mode: infinite loop (Train 2 → Train 4 → Train 2 → ...)

**Test results from final integration:**
- ✅ Both trains run their full cycle correctly
- ✅ Sensors trigger appropriately at both ends
- ✅ Slowdown / stop / pause / reverse sequence works as designed
- ✅ Turnout switches reliably between trains
- ✅ Loop continues until manually stopped

---

*End of handoff document. Good luck with the next phase of the project!*
