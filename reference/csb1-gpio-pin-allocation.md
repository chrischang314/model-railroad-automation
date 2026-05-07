# EX-CSB1 GPIO Pin Allocation

The EX-CSB1 exposes 13 ESP32 GPIO pins on its rear header. This document is the
authoritative map of which pins are in use on this layout, which are reserved
for hardware purposes, and which are physically available for future expansion.

**All CSB1 GPIO is 3.3 V logic.** Anything driven from a 5 V source must pass
through the BSS138 level shifter on the bench.

## Current allocation

| Pin   | Status              | Used for                                   | Notes |
| ----- | ------------------- | ------------------------------------------ | ----- |
| IO33  | **In use**          | Sensor 1001 input (home end of long track) | Always free on a bare CSB1. |
| IO26  | **In use**          | Sensor 1002 input (far end of long track)  | Free without MotorShield8874; reserved if stacked. |
| IO16  | **In use**          | Sensor 1003 input (reserved future)        | Wired through; no IR pair installed yet. |
| IO17  | **In use**          | Sensor 1004 input (reserved future)        | Wired through; no IR pair installed yet. |
| IO04  | Available           | -                                          | Free without MotorShield. |
| IO05  | Available           | -                                          | Free without MotorShield. |
| IO13  | Available           | -                                          | Free without MotorShield. |
| IO18  | Available           | -                                          | Free without MotorShield. |
| IO12  | Available (caveat)  | -                                          | ESP32 strapping pin -- if pulled HIGH at boot the chip won't start. Use as **input only with no external pullup** or expect boot issues. |
| IO36  | Available, **input only** | -                                    | Cannot drive outputs; pure input. |
| IO39  | Available, **input only** | -                                    | Cannot drive outputs; pure input. |
| IO01  | **DO NOT USE**      | UART0 TX                                   | Required for USB serial debug; using it as GPIO breaks the serial console. |
| IO03  | **DO NOT USE**      | UART0 RX                                   | Required for USB serial debug. |
| IO21  | **DO NOT USE**      | I2C SDA                                    | Used by the OLED and the Qwiic header. |
| IO22  | **DO NOT USE**      | I2C SCL                                    | Used by the OLED and the Qwiic header. |
| IO32  | **DO NOT USE**      | Booster Input                              | Documented as reserved by DCC-EX. |

## What the "MotorShield" caveat means

If you ever stack the EX-MotorShield8874 onto the CSB1 (for a second power
district or a programming track booster), it consumes IO04, IO05, IO13, IO16,
IO17, IO18, IO26, and the analog current-sense pins. That collides with all
four current sensor inputs. If you go down that road, plan to migrate sensors
off CSB1 GPIO and onto an MCP23017 (or similar) I2C expander connected via the
Qwiic header. The code change is small (just point your `<S>` declarations at
the new vpin numbers); the wiring change is large.

## Free pins available, ranked

If you need to add another input or output without disturbing the shuttle,
prefer them in this order:

1. **IO04, IO05, IO13, IO18** -- general purpose, fully unrestricted, 3.3 V.
2. **IO36, IO39** -- only if you need an input (they cannot drive outputs).
3. **IO12** -- last resort. Strapping pin; misbehaves at boot if pulled high.

## Header pinout reminder

The CSB1's rear GPIO header has labels printed on the silkscreen. Power and
ground rails are on the same header:

- `3V3` (or `+`) -- 3.3 V supply, ~50 mA available for low-current sensors
- `G` -- ground; multiple physical pins are tied together
- Numbered `IO`xx pins as listed above

The BSS138 level shifter's LV side currently consumes one `3V3` and one `G`,
plus the four signal pins listed above.

## Cross-reference

- See [`../docs/wiring-diagram.md`](../docs/wiring-diagram.md) for the full
  Arduino -> level shifter -> CSB1 wire-by-wire map.
- See [`i2c-address-allocation.md`](i2c-address-allocation.md) if you plan to
  add an I2C expander instead of consuming more GPIO.
- See [the handoff document Section 4](../docs/handoff-document.md#4-layout-documentation)
  for the full layout-side mapping (sensor IDs, vpins, and physical positions).
