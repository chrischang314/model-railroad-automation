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
