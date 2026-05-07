# Wiring Diagram

Every wire on the bench, terminal-by-terminal. Refer to this document when
you wire things up from scratch, when troubleshooting "why is this sensor not
working", or when you need to safely disassemble for transport.

## High-level topology

```
[ IR sensor pairs ] ---screw terminals---> [ RIR4 shield ]
                                                ||
                                          (shield headers)
                                                ||
                                          [ Arduino Uno ] -- USB power
                                          (sketch outputs D4..D7)
                                                |
                                       6 male->female jumpers
                                                |
                                                v
                              [ BSS138 level shifter HV side ]
                                                |
                                       4 internal channel xforms
                                                |
                                                v
                              [ BSS138 level shifter LV side ]
                                                |
                                       6 female->female jumpers
                                                |
                                                v
                                  [ EX-CSB1 GPIO header ]
                                  IO33, IO26, IO16, IO17, 3V3, GND
```

Total external jumpers between the two boards: **12** (6 on each side of
the level shifter).

## IR sensor pair to RIR4 (per pair)

The Azatrax IR pair has four wires running to terminal blocks on the RIR4.
"n" below is the detector number 1..4. Each detector has its own block of
terminal screws.

| Wire color (from sensor pair) | RIR4 terminal | Notes |
| --- | --- | --- |
| Orange / red (clear emitter LED) | **nK** | "K" = anode side |
| Green / blue (dark phototransistor) | **nF** | "F" = phototransistor input |
| White (across-track common) | **X** | Shared common across all four detectors |
| Yellow (the other common) | the matching X-row terminal | RIR4 has a small terminal-block legend on the silkscreen |

The clear LED and the dark phototransistor face each other across the rails,
so a passing train silhouette breaks the beam.

## Arduino + RIR4 stack

The RIR4 plugs straight onto the Arduino Uno's shield headers. No wiring
between them -- the shield pinout aligns with the Uno's:

- I2C: SDA = A4, SCL = A5
- 5 V power and GND from the Uno's standard headers

The RIR4 has stackable female headers on top, used here as a convenient
take-off point for jumper wires going to the level shifter.

## Arduino/RIR4 -> BSS138 (HV side, 5 V)

6 male-to-female jumpers from the RIR4's stacked top header into the BSS138's
HV side.

| From: RIR4 socket | To: BSS138 HV pin | Wire purpose |
| --- | --- | --- |
| 5V (Power row)    | HV                | 5 V supply for the HV side |
| GND (Power row)   | GND (HV side)     | Common ground reference |
| D4 (Digital row)  | A1                | Detector 1 mirror signal |
| D5 (Digital row)  | A2                | Detector 2 mirror signal |
| D6 (Digital row)  | A3                | Detector 3 mirror signal |
| D7 (Digital row)  | A4                | Detector 4 mirror signal |

## BSS138 -> CSB1 (LV side, 3.3 V)

6 female-to-female jumpers from the BSS138's LV side into the CSB1's GPIO
header.

| From: BSS138 LV pin | To: CSB1 header label | Wire purpose |
| --- | --- | --- |
| LV                  | 3V3 (or "+")          | 3.3 V supply for the LV side |
| GND (LV side)       | G                     | Common ground reference (any G pin) |
| B1                  | IO33                  | Detector 1 -> Sensor 1001 |
| B2                  | IO26                  | Detector 2 -> Sensor 1002 |
| B3                  | IO16                  | Detector 3 -> Sensor 1003 (reserved) |
| B4                  | IO17                  | Detector 4 -> Sensor 1004 (reserved) |

## Track power feed

```
  CSB1 MAIN output  --->  Kato Terminal Unijoiner  --->  layout
        +                                                 |
        |                                                 |
        '---  (single feed point, anywhere on the loop) --'
```

The Kato Terminal Unijoiner part numbers:

- **N scale: #24-818** -- regular rail joiner with a short pigtail of
  red/white wire pre-attached.
- **HO scale: #24-827** -- HO equivalent.

Slide it onto any joint between two pieces of Unitrack and connect the other
end to the CSB1's MAIN output screw terminals. The CSB1 output is **not
polarity-sensitive** for DCC -- it produces a bipolar AC-like square wave --
so which wire goes to which terminal does not matter, **as long as you stay
consistent across every feeder.** Mixing polarities between feeders creates
an immediate short.

If you add more feeders for a larger layout, ensure all feeders carry the
same polarity.

### Special case: Kato double crossover (#20-210)

A Kato double crossover (#20-210 in N scale) has **four separate power feed
locations**, one per approach. The internal switching makes the crossover
unreliable as a power-passing junction -- power injected on one approach
does not reliably reach trains on the opposite side.

Symptom of insufficient feeders: a train stops or slows when it crosses to
the far side of the double crossover.

For most home layouts, **two feeders** (one on each side of the crossover)
is enough; four feeders are only needed when each of the four approaches
runs to its own electrically isolated track section. Using a Proto Design
Labs NDC decoder handles the internal frog and point routing but does not
turn the crossover into a power bridge.

## Power requirements

| Device | Source | Voltage | Notes |
| --- | --- | --- | --- |
| Arduino Uno R3 | USB-B from a phone charger or computer | 5 V (USB) | Or 7..12 V into the barrel jack. Never feed >5 V into the USB or the 5V pin directly. |
| Azatrax RIR4 | Arduino's 5 V via shield headers | 5 V | No separate supply needed |
| BSS138 HV side | 5 V from the Arduino via the HV pin | 5 V | Drawn through the BSS138 itself |
| BSS138 LV side | 3.3 V from the CSB1 via the LV pin | 3.3 V | Drawn from the CSB1's onboard regulator |
| EX-CSB1 | 12 V DC barrel jack supply | 12 V (typical) | Drives both logic and DCC track output |

## Power-up order

1. **Arduino first.** Plug in the USB cable. The blue LED on the RIR4 lights;
   serial monitor (if connected) prints the startup banner.
2. **CSB1 second.** Plug in the 12 V supply. The OLED lights and shows the
   IP address after WiFi connects.
3. **Verify before moving on.** With a multimeter, check 3.3 V on CSB1's
   3V3 pin and 5 V on the BSS138's HV pin. If either is wrong, power down
   and check the level shifter wiring.

## Quick continuity check (when things break)

When a sensor stops triggering in JMRI, work the chain in this order with a
multimeter set to DC voltage:

1. Probe between Arduino D4 (or whichever pin) and Arduino GND. Should idle
   HIGH (~5 V) and drop to LOW (~0 V) when you wave a hand at detector 1.
2. Probe BSS138 A1 (HV side input) and HV-side GND. Same as step 1.
3. Probe BSS138 B1 (LV side output) and LV-side GND. Should idle ~3.3 V and
   drop to ~0 V on trigger.
4. Probe CSB1 IO33 and CSB1 G. Same as step 3.
5. Send `<S>` to DCC-EX -- is the sensor configured?
6. Open JMRI Sensor Table -- does sensor 1001 toggle when you wave?

If a stage shows the right voltage swing but the next does not, the wire
between those two stages is broken or unseated.

## Wire color convention (recommended)

If you re-do the wiring or extend it, this color convention helps later
debugging at a glance:

- **Red** -- 5 V or 3.3 V (positive supply)
- **Black** -- GND
- **Yellow** -- detector signals (so they're visually distinct from power)

Currently the project uses whatever colors came in the jumper kits, which is
fine but means signal vs. power can only be told from the routing.

## Things you can disconnect for transport

- **The 12-wire jumper bundle** between Arduino+RIR4 and CSB1: pull both ends
  to break the bridge.
- **The track power lead**: remove the Kato Terminal Unijoiner.
- **The Arduino's USB cable.**
- **The CSB1's 12 V power.**

The RIR4 stays plugged onto the Arduino. The BSS138 stays in the breadboard.
The IR sensor pairs stay screwed into the RIR4 terminal blocks. Reassembly is
just plugging the 12-wire bundle back in and re-energizing in the order
above.
