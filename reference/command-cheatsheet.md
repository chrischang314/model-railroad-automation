# DCC-EX Command Cheatsheet

A focused list of the DCC-EX `<>` commands and EXRAIL macros that have actually
been used on this layout. For the full reference, see
[dcc-ex.com/reference/software/command-summary-consolidated.html](https://dcc-ex.com/reference/software/command-summary-consolidated.html).

These are sent through any of:
- JMRI -> Tools -> DCC-EX -> Send DCC++ Command (or DCC++ menu)
- WebThrottle-EX command box
- Telnet to the CSB1 on TCP port 2560

## Status and inventory

| Command | What it does |
| --- | --- |
| `<s>` | Status: firmware version, track power state. Lowercase. |
| `<S>` | List all configured sensors. Uppercase. |
| `<T>` | List all configured turnouts. |
| `<JA>` | List automations and routes loaded from `myAutomation.h`. |
| `<JR>` | List the roster (configured locos). |
| `<JT>` | List turnouts (alternative to `<T>`). |
| `<#>` | Show the maximum number of locos that can run simultaneously. |
| `<D I2C>` | Diagnostic: scan the I2C bus and report devices. |

## Track power

| Command | What it does |
| --- | --- |
| `<1>` | Power ON (both MAIN and PROG tracks). |
| `<1 MAIN>` | Power ON the MAIN track only. |
| `<1 PROG>` | Power ON the PROG track only. |
| `<0>` | Power OFF (both tracks). |
| `<!>` | Emergency stop: kill all loco speeds without cutting power. |

## Loco control (manual override)

Format: `<t loco_addr speed direction>`. Speed `0..127`. Direction `1` = forward,
`0` = reverse.

| Command | What it does |
| --- | --- |
| `<t 2 30 1>` | Train 2 forward at speed 30. |
| `<t 4 50 0>` | Train 4 reverse at speed 50. |
| `<t 2 0 1>` | Train 2 stop (speed 0, forward). |
| `<F loco fn 1>` | Turn function `fn` on loco `loco` to ON. |
| `<F 2 0 1>` | Turn F0 (headlight) on Train 2 ON. |
| `<F 2 0 0>` | Turn F0 OFF. |

## Turnout control (manual)

| Command | What it does |
| --- | --- |
| `<T 2 1>` | Throw turnout 2. |
| `<T 2 0>` | Close turnout 2. |
| `<T>` | List configured turnouts and their current state. |

## Sensor configuration and testing

Sensor configuration. Format: `<S sensor_id vpin pullup>`. Pullup `0` recommended
when an external level shifter actively drives both states.

| Command | What it does |
| --- | --- |
| `<S 1001 33 0>` | Configure sensor 1001 on vpin 33, pullup off. |
| `<S 1002 26 0>` | Configure sensor 1002 on vpin 26, pullup off. |
| `<S 1003 16 0>` | Configure sensor 1003 on vpin 16 (reserved). |
| `<S 1004 17 0>` | Configure sensor 1004 on vpin 17 (reserved). |
| `<S>` | List configured sensors. |
| `<s 1001 1>` | Force sensor 1001 to active (testing only). Lowercase `s`. |
| `<s 1001 0>` | Force sensor 1001 to inactive. |
| `<S 1001>` | Delete sensor 1001's configuration. |

The full canonical setup commands live in
[`../dcc-ex/sensor-setup-commands.txt`](../dcc-ex/sensor-setup-commands.txt) and
should be re-applied after every CSB1 reflash.

## EXRAIL routes and automations

| Command | What it does |
| --- | --- |
| `</START 100>` | Spawn the top task (Train 2). Send WITH `</START 200>` to start the full parallel shuttle. |
| `</START 200>` | Spawn the middle task (Train 4 / Train 5 alternating). Send with `</START 100>`. |
| `</START 110>` | Stop the shuttle gracefully (sets stop flag; both trains return home, then halt). |
| `</START 10 2>` | Start sequence 10 on loco 2. |
| `</PAUSE>` | Pause every running EXRAIL task (cooperative). |
| `</RESUME>` | Resume after pause. |
| `</KILL ALL>` | Terminate all running EXRAIL tasks. |
| `</KILL 10>` | Kill task with ID 10. |
| `</>` | List currently running EXRAIL tasks. |

## Useful EXRAIL macros (used in `myAutomation.h`)

These are written in the `myAutomation.h` source, not sent over the wire.

| Macro | What it does |
| --- | --- |
| `ROSTER(addr, name, functions)` | Declare a loco for WiThrottle. |
| `TURNOUTL(id, addr, name)` | Declare a DCC accessory turnout with label. |
| `ROUTE(id, name)` | Declare a triggerable command sequence. |
| `SEQUENCE(id)` | Private sub-routine usable from `SENDLOCO`. |
| `SET(vpin)` | Set virtual sensor `vpin` to active (creates the vpin if needed). |
| `RESET(vpin)` | Set virtual sensor `vpin` to inactive. |
| `AUTOSTART` | Run the following block automatically at boot. |
| `POWERON` | Turn on track power. |
| `THROW(n)` / `CLOSE(n)` | Throw or close turnout `n`. |
| `FWD(speed)` / `REV(speed)` / `STOP` | Loco motion control. |
| `AT(vpin)` | Block until vpin reads active. **Vpin, not sensor ID.** |
| `AT(-vpin)` | Block until vpin reads inactive (inverted polarity). |
| `IF(vpin)` / `ENDIF` | Conditional branching on a vpin state. |
| `DELAY(ms)` | Sleep `ms` milliseconds. |
| `DELAYRANDOM(min, max)` | Sleep a random duration in `[min, max]` ms. |
| `IF(vpin)` / `ENDIF` | Run the enclosed block only if vpin is active. |
| `IFNOT(vpin)` / `ENDIF` | Inverse: run only if vpin is inactive. |
| `SENDLOCO(addr, sequence_id)` | Dispatch loco `addr` to run sequence `id`. |
| `FON(fn)` / `FOFF(fn)` | Turn function `fn` on/off on the current loco. |
| `DONE` | End of a `ROUTE`/`SEQUENCE`/`AUTOSTART` block (required). |

**`AT()` operates on vpin numbers, not sensor IDs.** Sensor 1001 lives on vpin
33, so use `AT(33)`, not `AT(1001)`. Negative vpin inverts polarity.

## Things to avoid (don't waste time on these)

| Don't use | Why |
| --- | --- |
| `SENSOR(id, vpin, pullup)` | Doesn't exist in CommandStation-EX 5.6.0. Configure sensors at runtime via `<S>` instead. |
| `AT(sensor_id)` | `AT()` takes a vpin, not a sensor ID. Wrong vpin = silent timeout. |
| Plug 5 V Arduino shields directly onto CSB1 GPIO | CSB1 is 3.3 V; risks ESP32 damage. WiFi died once during testing. Use the BSS138 level shifter. |
| `AT(33)` and `AT(-33)` interchangeably | The chosen polarity must match the Arduino sketch's drive logic. Currently `AT(positive_vpin)` is correct because the sketch drives LOW when occupied. |

## Quick diagnostic flow when something doesn't work

1. `<s>` -- is the firmware running, is power on?
2. `<S>` -- are the expected sensors listed with correct vpins?
3. `<JA>` -- is the automation loaded?
4. `<t addr speed dir>` -- can the loco move under manual control?
5. `<T addr 1>` / `<T addr 0>` -- does the turnout switch under manual control?
6. JMRI Sensor Table -- do sensors toggle when triggered physically?
7. JMRI Traffic Monitor -- do the right commands flow when the script runs?
