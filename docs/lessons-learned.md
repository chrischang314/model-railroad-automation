# Lessons Learned

A focused extract of the DOs, DON'Ts, mistakes, and subtle nuances from the
project's history. Read this before extending the layout, before debugging
anything weird, and **especially** before asking an LLM to write EXRAIL code
for you.

This is the **opinionated** version of Section 10 of
[`handoff-document.md`](handoff-document.md). The handoff is the authoritative
text; this file is the elevator pitch.

## DOs

- **Always check voltage compatibility before plugging anything into the
  CSB1.** The CSB1 is 3.3 V; many Arduino accessories are 5 V. Mismatch can
  damage the ESP32. The level shifter is mandatory for any 5 V signal source.
- **Use Kato Terminal Unijoiners for track power.** Simple, reliable, and
  Kato-approved. One feeder is enough for layouts under ~8 ft.
- **For Kato #4 turnouts, set the underside screw to "non-power-routing"**
  for DCC operation.
- **Set up an isolated programming track using plastic Unijoiners.** Other
  decoders on the layout can interfere with both reads and writes if they
  share the bus during programming.
- **Back up `myAutomation.h` before any flash.** EX-Installer can sometimes
  overwrite it. The `dcc-ex/myAutomation-backup.h` in this repo is the
  always-recoverable fallback.
- **Re-send sensor configuration commands after every CSB1 flash.** They do
  not reliably persist through firmware updates in version 5.6.0. The
  authoritative list is in [`../dcc-ex/sensor-setup-commands.txt`](../dcc-ex/sensor-setup-commands.txt).
- **Test components individually before integration.** Verify Arduino+RIR4
  standalone first (Serial Monitor at 9600 baud should show "Detectors:
  ...."). Then add the bridge. Then add the CSB1 side. Each layer is
  individually testable.
- **Solder pin headers in order: first pin, last pin, then middle pins.**
  Lets you correct alignment before all pins are committed.
- **Inspect every solder joint visually.** Shiny, cone-shaped, no bridges,
  no dull cold joints.
- **Use the Traffic Monitor in JMRI** to see exactly what commands flow
  between JMRI and DCC-EX. Most issues become obvious there.
- **Search the DCC-EX Discord** before writing custom integrations. Many
  edge cases have community solutions.
- **Configure sensors at runtime with `<S>` commands**, not via an EXRAIL
  `SENSOR()` macro -- the macro doesn't exist in 5.6.0.

## DON'Ts

- **Don't plug a 5 V Arduino shield directly onto the CSB1's I2C lines.**
  Risks ESP32 damage. Confirmed empirically on this project: WiFi died.
- **Don't assume EXRAIL macros (`SENSOR()`, `EXIOExpander HAL()`, etc.)
  exist** -- verify against your specific DCC-EX version's documentation.
  Many AI-suggested EXRAIL syntax variants are wrong.
- **Don't use `AT(sensor_id)`.** `AT()` takes a vpin, not a sensor ID.
  They're often the same in tutorials but are different here (e.g. sensor
  1001 lives on vpin 33, so use `AT(33)`).
- **Don't use IO01 or IO03 on the CSB1.** UART0 -- reserved for USB serial
  debugging.
- **Don't use IO32 on the CSB1.** Reserved for booster input.
- **Don't power the Arduino's 5 V pin directly with 9 V or higher.** Skips
  the regulator and destroys the chip.
- **Don't run multiple DCC-EX commands without waiting for responses.**
  Especially `<S>` configuration -- wait for `<O>` before sending the next.
- **Don't try to make the Arduino simultaneously be I2C master (to RIR4)
  and slave (to CSB1) with EX-IOExpander.** This was attempted and
  abandoned. Use the GPIO mirror approach instead.
- **Don't trust LLM-generated EXRAIL scripts blindly.** The DCC-EX docs
  explicitly warn that AI assistants get EXRAIL wrong frequently.
- **Don't connect non-DCC accessories to track power.** Use separate 5 V /
  3.3 V supplies for electronics.

## The mistakes we made (and what fixed them)

These are real, in chronological order, with the dead-end and the fix:

1. **Stack RIR4 directly on CSB1 GPIO headers.**
   Result: WiFi died on the CSB1; the board became unreachable until the
   RIR4 was removed.
   Cause: the RIR4's I2C pull-ups tie SDA/SCL to 5 V. The ESP32's absolute
   maximum input voltage per pin is ~3.6 V. Repeatedly stacking and
   unstacking is rolling the dice on permanent damage every time -- the
   fact that WiFi recovered after removing the shield is fortunate, not
   guaranteed.
   Fix: GPIO mirror architecture with the BSS138 level shifter. **Never**
   plug a 5 V Arduino shield directly onto CSB1 GPIO again.

2. **Used `SENSOR(id, vpin, pullup)` macro in `myAutomation.h`.**
   Result: compilation failed with "SENSOR was not declared in this scope."
   Cause: that macro doesn't exist in v5.6.0.
   Fix: configure sensors at runtime with `<S>` commands instead.

3. **Used `AT(1001)` to wait for sensor 1001.**
   Result: train didn't react when sensor triggered.
   Cause: `AT()` operates on vpin numbers, not sensor IDs.
   Fix: use `AT(33)` (the vpin for that sensor).

4. **Tried `AT(-vpin)` for inverted polarity.**
   Result: worked but was the wrong choice given the Arduino sketch's drive
   logic.
   Fix: after the Arduino sketch was modified to drive pins LOW when
   occupied, the matching DCC-EX side wanted `AT(positive_vpin)`. Confirmed
   empirically; both forms are syntactically valid so it's easy to pick the
   wrong one.

5. **Set cruise speed to 100 (full speed).**
   Result: train overshot sensors at high speed; missed detection or
   coasted past stopping point.
   Fix: reduced to 80, with a 3 s creep at speed 40.

6. **Confused "Send DCC++ Command" window with the Traffic Monitor.**
   Result: sent commands but didn't see responses.
   Fix: use the Traffic Monitor for both sending and viewing responses.

7. **Initial Arduino sketch had wrong polarity.**
   Result: JMRI showed sensors as Active when no train present, Inactive
   when present.
   Fix: inverted the GPIO logic in the sketch (HIGH <-> LOW).

8. **Mac's Bluetooth devices appeared as serial ports.**
   Result: EX-Installer connected to the wrong port.
   Fix: unplug CSB1, see which port disappears, reconnect to confirm.

9. **Tried to integrate via EX-IOExpander.**
   Result: concept was sound but execution had I2C dual-master complications.
   Fix: pivoted to GPIO mirror approach. Simpler. More robust. Easier to
   debug.

## Subtle nuances

- **Forward/reverse depends on physical loco orientation.** `FWD` doesn't
  mean "away from station" -- it means "the direction the loco's decoder
  considers forward." If your trains move the wrong way, physically turn
  the loco around rather than swapping FWD/REV in the script.

- **CV3/CV4 (acceleration/deceleration) momentum on decoders affects
  stopping distance.** High momentum = trains coast a long way after STOP.
  For automation, lower values (5..10) give more predictable stops.

- **The OLED on the CSB1 lives on the same I2C bus as anything you connect
  via the level shifter.** This is fine -- multiple devices coexist on I2C
  -- but be aware of address conflicts.

- **Sensor polarity has multiple inversions in the chain:** RIR4 register
  bit (occupied=1), Arduino sketch (drives LOW when occupied), level shifter
  (passes through), CSB1 read (active high or low based on `AT()` polarity).
  Trust empirical testing over derived logic; the chain has too many places
  for sign errors.

- **EXRAIL routes appear as turnouts in JMRI's Turnout Table** (not the
  Routes Table). Confusing but standard.

- **Re-flashing in EX-Installer can wipe `myAutomation.h`.** Always keep a
  backup outside the project folder. The `dcc-ex/myAutomation-backup.h`
  in this repo is one such safety net.

- **The DCC-EX team explicitly warns that AI assistants get EXRAIL wrong
  frequently.** Don't trust LLM-generated EXRAIL syntax without
  verification against the current command reference.

- **EX-WebThrottle is the cheap network diagnostic.** When JMRI cannot
  connect, open `http://<csb1-ip>/` in a browser. If EX-WebThrottle loads,
  the CSB1 is healthy and the issue is JMRI-side. If it does not, the
  problem is network or CSB1 boot state -- start there before debugging
  JMRI.

- **JMRI does not auto-reconnect.** After any CSB1 reboot, fully quit JMRI
  and relaunch. Just closing the connection window and reopening it does
  not work reliably.

- **`dccex.local` (mDNS) survives DHCP IP changes.** If your home network
  reassigns the CSB1's IP after a router reboot, `dccex.local` keeps
  working without reconfiguring JMRI. If your network does not support
  mDNS, set a DHCP reservation in the router instead.
