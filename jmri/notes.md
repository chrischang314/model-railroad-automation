# JMRI Configuration Notes

JMRI (Java Model Railroad Interface) is the cross-platform desktop application
used for everything other than DCC-EX itself: throttle windows, sensor and
turnout tables, decoder programming, traffic monitoring, and panel design.

This file captures the JMRI-side configuration that pairs with this project.
It is **not** a substitute for the [official JMRI documentation](https://www.jmri.org/help/en/).

## Three ways to talk to DCC-EX

1. **JMRI** (this file's focus). Full GUI: throttles, tables, panels,
   DecoderPro.
2. **EX-WebThrottle** -- DCC-EX's built-in web interface. Open
   `http://<csb1-ip>/` in any browser on the same network. Has a command
   input field that accepts raw `<...>` commands -- a useful diagnostic
   when JMRI is misbehaving.
3. **Telnet / netcat to TCP port 2560.** `nc <csb1-ip> 2560` from any
   terminal. Type `<...>` commands and read replies. Lowest-level option,
   handy when even the browser refuses to load.

EX-WebThrottle and JMRI can talk to the CSB1 simultaneously without
conflict; both just open TCP connections to port 2560.

## Connection setup

1. JMRI -> **Edit -> Preferences -> Connections**
2. **Add new** connection.
3. **System manufacturer:** DCC-EX (or, on older JMRI builds, DCC++).
4. **Connection:** TCP/IP server (or LAN/Wi-Fi connection).
5. **IP address:** the CSB1's address. Found:
   - On the OLED display at boot.
   - In Access Point mode: `192.168.4.1`.
   - On the home router's DHCP client list.
   - Or use the mDNS hostname **`dccex.local`** instead of the raw IP.
     Most modern home networks support mDNS; this insulates JMRI from
     DHCP-driven IP changes after a router reboot. If `dccex.local` does
     not resolve, fall back to the raw IP.
6. **Port:** `2560`.
7. Save and restart JMRI.

If your home network reassigns the CSB1's IP unpredictably and `dccex.local`
is not working, set a **DHCP reservation** in your router for the CSB1's MAC
address. The router will then hand out a fixed IP every time.

When the connection is healthy, the JMRI startup log shows
`DCC-EX connected, version 5.6.0-Prod` (or similar).

## Typical JMRI windows for this layout

| Window | Path | Purpose |
| --- | --- | --- |
| Throttle | Tools -> Throttle -> New Throttle | Manual loco control during tuning. |
| Sensor Table | Tools -> Tables -> Sensors | See live sensor states (1001..1004). |
| Turnout Table | Tools -> Tables -> Turnouts | Manually throw/close Turnout 2 for testing. EXRAIL routes also show up here. |
| Roster | Tools -> Tables -> Roster | List of locos with addresses, names, decoder profiles. |
| Send DCC++ Command | DCC-EX (or DCC++) menu -> Send DCC++ Command | Type raw `<...>` commands. |
| Traffic Monitor | DCC-EX (or DCC++) menu -> Traffic Monitor | See every command flowing in/out. **Best debugging tool.** |
| DecoderPro | Standalone launcher icon | Read/write decoder CVs on the PROG track. |

## Verifying the bring-up

After flashing the CSB1 and powering everything up:

1. Open the **Traffic Monitor**. Watch for the periodic heartbeat traffic.
2. Open **Send DCC++ Command** and send `<s>`. Confirm the version reply.
3. Send `<S>` -- the sensor list should match what's in
   [`../dcc-ex/sensor-setup-commands.txt`](../dcc-ex/sensor-setup-commands.txt).
   If empty, paste the `<S 1001 33 0>` etc. lines.
4. Send `<JA>` -- routes 100 (Start Shuttle) and sequences 10, 20 should be
   listed.
5. Open the Sensor Table -- 1001 and 1002 should appear and toggle when you
   wave a hand at the IR pairs.
6. Open the Turnout Table -- Turnouts 1 and 2 should be listed; clicking the
   state should switch the physical turnout (Turnout 2 in particular).
7. Open a Throttle, select Train 2, set speed 30 forward -- the Shinkansen
   should move. Repeat for Train 4.
8. From Send DCC++ Command, send `</START 100>` -- the shuttle starts.

## Sensor polarity in JMRI

Each sensor in JMRI has an "Inverted" checkbox. Currently this is **off** for
sensors 1001 and 1002, because the Arduino sketch has already inverted polarity
at its end (drives LOW when occupied, which matches DCC-EX's expectation that
"active = sensor reports occupied"). Don't enable JMRI's inverter unless you
also change the sketch -- you'll just compound the inversions.

## Traffic Monitor tips

- The first three letters of every line tell you a lot:
  - `<jA ...` -- automation/route info reply.
  - `<S ...` / `<JS ...` -- sensor info.
  - `<l ...` -- loco state update.
  - `<H ...` -- turnout state update.
  - `<X ...` -- error/unknown command.
- If you see lots of `<X>` replies during script execution, suspect a
  malformed EXRAIL macro in `myAutomation.h`.
- Monitor traffic during a full shuttle cycle to make sure the expected
  `THROW`, `CLOSE`, `t`, and sensor-trigger commands all fire.

## Panels

`panels/` is reserved for JMRI panel XML files. Currently empty. A future
panel could:

- Show a graphical schematic of the layout with live sensor and turnout
  state.
- Add a soft button to trigger `</START 100>` and `</KILL ALL>` for friends
  who don't want to type DCC-EX commands.
- Display loco position estimates based on the most recent sensor trigger.

To create a panel:
1. Tools -> Panels -> New Panel -> Layout Editor (or Panel Editor).
2. Save as `panels/shuttle.xml` (JMRI's "Save panels" command).

## Persistence quirks

JMRI saves connection profiles, sensor/turnout/roster tables, and panel files
in your user profile (`~/JMRI/` on Mac and Linux,
`Documents\JMRI\` on Windows). These files can be added to git if you want to
share them with future-you on a different machine. They're not committed to
this repo by default because they include host-specific paths and IP addresses.

If you do commit them, scrub:
- Hostnames and IP addresses in `connection.xml`.
- Local file paths in `roster.xml`.

## Troubleshooting JMRI -- DCC-EX

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| JMRI hangs on "Connecting" | Wrong IP or CSB1 not on the network | Ping the CSB1 from a terminal first. If ping fails, fix WiFi before debugging JMRI. Also try opening `http://<csb1-ip>/` in a browser -- if **EX-WebThrottle** loads, the CSB1 is healthy and the issue is JMRI-side. |
| JMRI does not reconnect after CSB1 reboot | JMRI does not auto-reconnect after the connection drops | Quit JMRI completely (not just close the window) and relaunch. The OLED shows the (possibly new) IP after the reboot. |
| Connection drops after a flash | EX-Installer rebooted the CSB1 with new credentials | Wait ~30 s; the OLED will show the new IP. Restart JMRI. |
| Sensor table empty | Sensor declarations not configured on DCC-EX | Send the lines from `dcc-ex/sensor-setup-commands.txt`. |
| Sensor toggles in JMRI but `AT()` doesn't react | Wrong vpin in EXRAIL | `AT()` takes vpin not sensor ID. Sensor 1001 lives on vpin 33; use `AT(33)`. |
| Throttle works but turnouts don't | Decoder address mismatch | `<T>` lists known turnouts. Re-program the PDL decoder with a magnet if needed. |
| `</START 100>` does nothing | Route 100 not loaded | Send `<JA>` to confirm. If missing, re-flash with the current `myAutomation.h`. |
