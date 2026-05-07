# I2C Address Allocation

This layout has **two physically separate I2C buses**. Don't confuse them.

| Bus | Master | Voltage | Devices |
| --- | --- | --- | --- |
| **Arduino bus** | Arduino Uno R3 | 5 V | Azatrax RIR4 (0x38) |
| **CSB1 bus** (Qwiic header) | EX-CSB1 (ESP32) | 3.3 V | OLED display (0x3C), reserved for future I2C accessories |

The two buses are **not connected** -- the BSS138 level shifter only carries
four data signals plus power/ground; it does not bridge I2C between the
Arduino and CSB1. This is intentional. Bridging two I2C masters onto one bus
is a hard problem (dual-master arbitration, shared pull-ups, conflicting
clock stretching) and was the reason the project switched away from the
EX-IOExpander approach.

## Arduino-side I2C bus (5 V)

| Address | Device | Notes |
| --- | --- | --- |
| `0x38`  | Azatrax RIR4 | Currently configured as 0x38. The library is instantiated as `Azatrax RIR4(0x38);`. |

The RIR4 has **three DIP switches** that select one of **eight possible I2C
addresses**. The Azatrax PDF user guide that ships with the RIR4 has the
authoritative address-vs-switch table. (Some Azatrax marketing material lists
addresses in the `0x48..0x4F` range; the board you have was set to `0x38`.
**Always confirm by running an I2C scan, not by guessing from documentation.**)

Up to 8 RIR4 boards can be stacked on a single Arduino with unique addresses,
giving 32 detectors total.

The Arduino's hardware I2C is wired to the RIR4 via the shield headers
(SDA = A4, SCL = A5 on classic Uno R3). Pullups are present on the RIR4
shield; no external pullups needed.

## CSB1-side I2C bus (3.3 V)

| Address | Device | Notes |
| --- | --- | --- |
| `0x3C`  | OLED display | Comes with the CSB1. Plugs into the I2C female header. Shows IP address, firmware version, throttle count, etc. |

**Free addresses for future I2C accessories on the CSB1 bus:** any 7-bit
address not equal to 0x3C, the most useful ranges being:
- `0x20..0x27` -- MCP23017 GPIO expander (8 boards possible, address set by
  three address-pin straps)
- `0x40..0x47` -- common range for current sensors and PWM drivers
- `0x48..0x4F` -- common range for ADCs
- `0x50..0x57` -- EEPROM range; might be used by a future EX-EEPROM if
  CommandStation-EX supports persistent storage off-chip
- `0x68..0x6F` -- RTCs, IMUs, etc.

## How to inspect the bus

`<D I2C>` over the DCC-EX command interface scans the CSB1's I2C bus and
prints a list of addresses that responded. Use this to:
- Confirm a new I2C accessory was detected after wiring it up.
- Catch address conflicts before they cause silent failures.
- Verify the OLED is alive after a reflash.

The Arduino bus is not exposed to DCC-EX; if you need to scan it, run a
standalone Arduino sketch that calls `Wire.beginTransmission(addr)` for every
address in `0x03..0x77` and prints the ones that ACK.

## Why two buses?

The Arduino's job is exactly to be the single I2C master for the RIR4. The
CSB1 is the I2C master for its own bus (OLED, future expanders). Connecting
them via a level shifter would require both sides to relinquish master state,
or one side to pretend to be a slave. This is doable but fragile:

- **Two masters fight for the bus.** Even with arbitration, you get
  intermittent dropped messages.
- **DCC-EX has no Azatrax driver.** Even if the CSB1 could see the RIR4 over
  I2C, it has no protocol code to read the detector registers.
- **Pullup voltage matters.** I2C pullups must be tied to the bus's logic
  voltage; a level shifter is required for cross-voltage I2C, and the
  cheap BSS138 shifters are bidirectional but not optimized for I2C speed.

The GPIO mirror approach sidesteps all of this. The Arduino does I2C with the
RIR4. The CSB1 reads simple digital inputs. The level shifter only translates
those four 5 V signals down to 3.3 V. Robust and easy to debug.

## Future accessories under consideration

| Device | Likely address | Bus | Use case |
| --- | --- | --- | --- |
| MCP23017 #1 | 0x20 | CSB1 | Add 16 more sensor inputs without using CSB1 GPIO |
| MCP23017 #2 | 0x21 | CSB1 | Servo control or LED signal driver |
| Adafruit PWM driver (PCA9685) | 0x40 | CSB1 | Smooth servo motion for turntables, semaphores |
| Additional Azatrax RIR4s | 0x39..0x3F | Arduino | Up to 8 stacked on one Arduino, unique I2C addresses via DIP switches |

See [`../future/shopping-list.md`](../future/shopping-list.md) for purchase
status of each.
