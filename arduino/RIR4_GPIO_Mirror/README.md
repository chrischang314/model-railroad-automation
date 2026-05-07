# RIR4 GPIO Mirror -- Arduino Sketch

The bridge sketch that translates Azatrax RIR4 detector states (read over
I2C) into simple digital GPIO outputs (D4..D7) for the EX-CSB1 to read via
the BSS138 level shifter.

The sketch itself is [`RIR4_GPIO_Mirror.ino`](RIR4_GPIO_Mirror.ino). This
README captures the setup steps and the gotchas that come up when bringing
up a fresh Arduino + RIR4 stack.

## Required hardware

- Arduino Uno R3 (5 V, ATmega328P) -- official or clone
- Azatrax RIR4 IR sensor shield (4 channels)
- 4 IR sensor pairs (LED + phototransistor) wired into the RIR4's terminal
  blocks
- USB-B cable for programming the Arduino

## One-time IDE setup

1. Install **Arduino IDE 2.x** from
   [arduino.cc/en/software](https://www.arduino.cc/en/software).

2. **USB driver (Windows / macOS).** The IDE installer ships drivers for
   official Arduino boards (FTDI). Many clones (Elegoo, Keyestudio, etc.)
   use the **CH340** USB chip and need a separate driver:

   - Search "**CH340 driver Windows**" or "**CH340 driver macOS**" and
     download from `wch.cn` or `sparkfun.com`.
   - On macOS, you may need to allow the kext in **System Settings ->
     Privacy & Security** the first time you load it.
   - If the Arduino does not appear under **Tools -> Port** after plugging
     it in, the driver is the most likely cause.

3. **Install the Azatrax library.** Download `AzatraxArduinoLib.zip` from
   [azatrax.com](https://www.azatrax.com) (RIR4 product page). In the IDE:
   **Sketch -> Include Library -> Add .ZIP Library...** and pick the zip.

## Bring-up checklist (do these in order)

The point of the order is to fail fast if any single layer is broken.

### Step 1: Blink test

Confirm the Arduino itself works before introducing the RIR4.

1. Plug the bare Arduino into the computer via USB-B.
2. **File -> Examples -> 01.Basics -> Blink**, then **Upload**.
3. Verify the on-board LED blinks at 1 Hz.

If upload fails:

| Symptom | Likely cause |
| --- | --- |
| "Port not found" / no port listed | USB driver missing (CH340 on clones); cable is power-only |
| "Permission denied" on macOS / Linux | Add user to the `dialout` group (Linux) or grant Terminal access in Privacy settings (macOS) |
| Random reboots while uploading | USB cable too long or unpowered hub; switch cables |

### Step 2: Stack the RIR4 (with everything else off)

Power down, plug the RIR4 onto the Arduino's shield headers, double-check
orientation (USB jack is the visual reference -- the RIR4's "this end up"
markings should match), then re-plug the USB.

The RIR4's blue power LED should light up immediately; that proves it is
getting 5 V from the Arduino. **Do not connect anything else yet.**

### Step 3: Verify RIR4 with the example sketch

The Azatrax library ships an example that prints detector states to the
Serial Monitor:

1. **File -> Examples -> Azatrax -> rir4_demo** (or similar).
2. Confirm the I2C address in the sketch matches the **DIP switch
   setting** on your RIR4. The address is one of eight values selected by
   the three DIP switches; the Azatrax PDF that came with the board has
   the table. Currently this layout uses **0x38**.
3. Upload the sketch.
4. Open **Tools -> Serial Monitor**, baud rate **9600**.

Expected output (per detector, every ~1 s):

```
Detector 1: clear
Detector 2: clear
Detector 3: clear
Detector 4: clear
```

Wave a hand or piece of paper between an IR pair -- the matching detector
should flip to `occupied`. If nothing changes, see the troubleshooting
table below.

### Step 4: Upload `RIR4_GPIO_Mirror.ino`

Replace the demo with this project's mirror sketch
([`RIR4_GPIO_Mirror.ino`](RIR4_GPIO_Mirror.ino)). With the Serial Monitor
still open at 9600 baud, expect:

```
RIR4 GPIO Mirror starting...
Output pins configured. Polling RIR4...
Detectors: ....
Detectors: X...
Detectors: ....
```

`X` marks an occupied detector; `.` marks vacant. The bitmap reads from
detector 4 on the left to detector 1 on the right.

### Step 5: Hook up the level shifter and CSB1

Only after Steps 1..4 pass cleanly, wire up the BSS138 level shifter and
the CSB1 GPIO. See [`../../docs/wiring-diagram.md`](../../docs/wiring-diagram.md)
for the full pinout.

## Polarity convention

The sketch deliberately drives **GPIO LOW when a detector is occupied** and
**HIGH when vacant**. This is an arbitrary choice, but it is locked in:
the EXRAIL `myAutomation.h` script uses `AT(positive_vpin)` to wait for an
**active-high** signal on the CSB1 side, which only matches the polarity
chosen here.

If you ever flip the polarity in this sketch (e.g. swap the
`HIGH`/`LOW` pair in the `digitalWrite` call), you must also flip every
`AT(vpin)` to `AT(-vpin)` in `myAutomation.h`. Test empirically afterward;
the chain has multiple inversions and theoretical reasoning has been
unreliable on this project.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Blue LED on RIR4 does not light | Bad USB power, RIR4 misaligned on Arduino headers | Reseat the RIR4. Power-cycle. |
| `<D I2C>` on the CSB1 does not show 0x38 | (Different bus -- you cannot scan the Arduino's I2C from the CSB1.) | Run an I2C scanner sketch on the Arduino instead. |
| Demo sketch prints nothing | Wrong I2C address in the sketch vs. DIP switches | Match them. RIR4 has 8 possible addresses; the PDF has the table. |
| Demo prints but detectors never flip | IR sensor pair miswired or sensor pointing in the wrong direction | Verify each detector's `nK` (LED) and `nF` (phototransistor) terminals; LED and phototransistor must face each other through the train silhouette zone. |
| GPIO mirror outputs do not change | Sketch detected the RIR4 but the polling loop is stuck | Reset the Arduino (briefly disconnect USB). Re-open Serial Monitor. |
| CSB1 sees correct sensor changes for one channel and not others | One of the four jumper wires through the level shifter is loose | Check continuity from Arduino D5 (or whichever) -> BSS138 A2 -> BSS138 B2 -> CSB1 IO26 with a multimeter. |

## Reference

- [Azatrax RIR4 product page](https://www.azatrax.com)
- [Adafruit BSS138 level shifter](https://www.adafruit.com/product/757)
- [Arduino Uno R3 schematic / pinout](https://store.arduino.cc/products/arduino-uno-rev3)
