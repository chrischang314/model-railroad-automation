// myAutomation.h - Sensor-driven two-train alternating shuttle (v1.1.0)
//
// CHANGES vs v1.0.0:
//   - Headlight automation: F0 on at start of cycle, off at end (FON/FOFF)
//   - Graceful stop via virtual run-flag at vpin 2001 (SET / RESET / IF)
//   - Randomized station dwells via DELAYRANDOM (8-14 s instead of fixed 10 s)
//   - Inline tuning comments explaining the magic numbers
//
// HARDWARE (unchanged from v1.0.0):
//   Loco 2 = Shinkansen (Train A, runs first)
//   Loco 4 = E233 (Train B, runs second)
//   Turnout 2: thrown = Train 2's route, closed = Train 4's route
//   Sensor 1001 (vpin 33) = home end of long track
//   Sensor 1002 (vpin 26) = far end of long track
//   Virtual vpin 2001     = software-only run flag (no hardware)
//
// CONTROL ROUTES:
//   </START 100>          start the shuttle (sets run flag, dispatches Train 2)
//   </START 101>          GRACEFUL stop: clears run flag; current cycle finishes
//                         naturally, then no further dispatch
//   </KILL ALL>           IMMEDIATE stop: terminates running EXRAIL tasks now
//                         (use only if a graceful stop won't do)
//   <!>                   emergency loco e-stop (kills motor speeds)
//   </PAUSE> / </RESUME>  cooperative pause / resume of running tasks
//
// SENSOR CONFIGURATION (re-send after each flash via JMRI / EX-WebThrottle):
//   <S 1001 33 0>
//   <S 1002 26 0>
//   (Sensor 2001 is virtual; SET / RESET creates the vpin on demand.)

// ============================================================================
// Roster
// ============================================================================
ROSTER(2, "KATO Shinkansen", "F0/F1/F2")
ROSTER(4, "KATO E233", "F0/F1/F2")

// ============================================================================
// Turnouts
// ============================================================================
TURNOUTL(1, 1, "KATO Turnout 1")
TURNOUTL(2, 2, "KATO Turnout 2")

// ============================================================================
// Boot-time setup
// ============================================================================
AUTOSTART
POWERON
DONE

// ============================================================================
// Trigger routes (visible in JMRI's Turnout Table and on WiThrottle)
// ============================================================================

// Press </START 100> or "Start Shuttle" in WiThrottle to begin the loop.
ROUTE(100, "Start Shuttle")
  SET(2001)               // raise the run flag
  SENDLOCO(2, 10)         // dispatch Train 2 to its sequence
DONE

// Press </START 101> for a graceful stop. The currently-running cycle
// completes; the dispatch check at the end of each sequence sees the cleared
// flag and exits. No emergency stop, no stranded train.
ROUTE(101, "Stop Shuttle Gracefully")
  RESET(2001)             // lower the run flag
DONE

// ============================================================================
// Train 2 (Shinkansen) sequence
// ============================================================================
//
// Tuning rationale, recorded once for both trains:
//
//   FWD(80)        Cruise speed. Empirical sweet spot. Speed 100 caused
//                  overshoot at sensor 1002 (the train coasted past the buffer
//                  zone). Speed 60 felt unconvincingly slow visually. 80 hits
//                  the prototype-feel-vs.-reliable-stopping balance.
//
//   FWD(40)        Creep speed used for the last 3 s before STOP. Slow enough
//                  that decoder momentum (CV3/CV4) does not overshoot, fast
//                  enough that the train does not appear to stall. Pair this
//                  with whatever CV3/CV4 you settled on (see issue #2).
//
//   DELAY(3000)    Creep duration. With FWD(40) and current decoder momentum
//                  this puts the train roughly at the buffer-near position
//                  past the sensor. Adjust if you reposition sensors.
//
//   DELAYRANDOM(8000, 14000)
//                  Station dwell. Was a fixed DELAY(10000) in v1.0.0; the
//                  random spread (8 to 14 s) removes the metronome feel and
//                  is more prototypical for a real timetabled stop.
//
//   FON(0) / FOFF(0)
//                  Headlight on at start of cycle, off at home-station stop.
//                  F0 is directional on Kato EM13 decoders, so the leading
//                  lamp lights regardless of FWD/REV.

SEQUENCE(10)
  THROW(2)                // station turnout to Train 2's route
  DELAY(2000)             // let the solenoid settle before motion
  FON(0)                  // headlights on for the cycle

  FWD(80)                 // depart station, cruise out
  AT(26)                  // wait for vpin 26 (sensor 1002, far end)
  FWD(40)                 // slow to creep speed
  DELAY(3000)             // creep for 3 s, glide to stop
  STOP

  DELAYRANDOM(8000, 14000)  // far-end turnaround dwell

  REV(80)                 // depart far end, cruise back
  AT(33)                  // wait for vpin 33 (sensor 1001, home end)
  REV(40)
  DELAY(3000)
  STOP

  FOFF(0)                 // headlights off, train is "parked"

  DELAYRANDOM(8000, 14000)  // home-station dwell

  // Graceful-stop check: if the run flag is still set, dispatch Train 4.
  // Otherwise the sequence ends here and the shuttle stops cleanly.
  IF(2001)
    SENDLOCO(4, 20)
  ENDIF
DONE

// ============================================================================
// Train 4 (E233) sequence
// ============================================================================
SEQUENCE(20)
  CLOSE(2)                // station turnout to Train 4's route
  DELAY(2000)
  FON(0)

  FWD(80)
  AT(26)
  FWD(40)
  DELAY(3000)
  STOP

  DELAYRANDOM(8000, 14000)

  REV(80)
  AT(33)
  REV(40)
  DELAY(3000)
  STOP

  FOFF(0)

  DELAYRANDOM(8000, 14000)

  IF(2001)
    SENDLOCO(2, 10)       // back to Train 2 -- infinite loop while flag is set
  ENDIF
DONE
