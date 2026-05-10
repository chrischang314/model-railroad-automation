// myAutomation.h - Multi-track shuttle (v2.0.0-DRAFT)
//
// LAYOUT (see docs/layout-diagram.md):
//
//   Top track:    -------- (Train 2 lives here, shuttles back and forth)
//                          ^                                ^
//                          | S1 (vpin 33)                   | S2 (vpin 26)
//                          | beam crosses BOTH tracks       | beam crosses BOTH tracks
//                          v                                v
//   Middle track: --T2-----+--------- T1 -----------+---T3-----  (Trains 4 / 5 alternate)
//   Spur (BL):       \--- Train 5 home (off T2)
//   Spur (BR):                                      ---/   unused
//
// CRITICAL SENSOR CONSTRAINT
//   S1 and S2 are beam-break sensors whose beams pass across BOTH the top
//   and middle tracks. The sensor cannot tell which track tripped it.
//
//   This script handles that with TIME-SLICING: only ONE train is in motion
//   at any time. While Train X runs, all other trains are parked clear of
//   the sensor beams, so any S1/S2 trigger unambiguously belongs to X.
//
//   The cycle is: T2 lap -> T4 lap -> T2 lap -> T5 lap -> repeat.
//   Trains 4 and 5 alternate on the middle track; Train 2 runs on top
//   between every middle-track lap.
//
// PARKING POSITIONS (must be CLEAR of sensor beams when stopped):
//   Train 2  - west of S1 on the TOP track     (home position)
//              east of S2 on the TOP track     (far end)
//   Train 4  - west of S1 on the MIDDLE track  (home position)
//              east of S2 on the MIDDLE track  (far end)
//   Train 5  - on the bottom-left spur, off T2 (home position; off-beam)
//              east of S2 on the MIDDLE track  (far end)
//
//   If a train parks even partially on a sensor, the next train's first
//   AT(...) call will fire immediately and the cycle will desync. Tune
//   creep DELAY per train so each train fully clears the beam.
//
// TURNOUT POLICY
//
//   This layout's accessory decoders use INVERTED polarity vs. the typical
//   DCC convention. Across all three turnouts:
//     THROWN  = straight-through / main route
//     CLOSED  = diverging route
//
//   T1 (addr 1, double-slip) - kept THROWN at all times: top and middle
//                              pass straight through, no crossover.
//                              ("Open" position per the user's diagram.)
//   T2 (addr 2, left-hand)   - THROWN for Train 4's lap (middle main clear).
//                              CLOSED for Train 5's lap (spur connected to
//                              middle main). Default at boot is THROWN.
//   T3 (addr 3, right-hand)  - kept THROWN at all times (no diversion to
//                              the unused bottom-right spur).
//
// CONTROL ROUTES
//   </START 100>          start the shuttle (raises run flag, dispatches T2)
//   </START 101>          graceful stop (clears flag; current cycle finishes)
//   </KILL ALL>           immediate stop
//   <!>                   emergency loco e-stop
//
// SENSOR DECLARATIONS (re-send after every flash)
//   <S 1001 33 0>         S1 (home end of both tracks)
//   <S 1002 26 0>         S2 (far end of both tracks)
//   (vpins 2001 / 2002 are virtual flags; SET / RESET creates them on demand)
//
// VIRTUAL FLAGS
//   2001 - run flag           (set = running, reset = graceful stop pending)
//   2002 - middle alternator  (set = next middle is Train 5, reset = T4)
//
// EXRAIL 5.6.0 NOTES (learned the hard way)
//   - Nested IF (`IF(...) IF(...) ... ENDIF ENDIF`) parses without errors
//     but the inner block does not appear to fire reliably. Avoided here.
//   - This script uses ONLY top-level IF / ELSE / ENDIF blocks, which are
//     confirmed working.
//   - Trade-off: Train 2 always dispatches a middle train; the graceful-
//     stop check runs in SEQUENCE(20) and SEQUENCE(30) instead.

// ============================================================================
// Roster
// ============================================================================
ROSTER(2, "Train 2 (top)", "F0/F1/F2")
ROSTER(4, "Train 4 (middle)", "F0/F1/F2")
ROSTER(5, "Train 5 (middle, spur-stored)", "F0/F1/F2")

// ============================================================================
// Turnouts
// ============================================================================
TURNOUTL(1, 1, "T1 double-slip")
TURNOUTL(2, 2, "T2 spur entry")
TURNOUTL(3, 3, "T3 unused spur")

// ============================================================================
// Boot setup: power on, place turnouts in default positions
// ============================================================================
AUTOSTART
POWERON
THROW(1)              // T1 -> straight-through ("open" / no crossover)
THROW(2)              // T2 -> middle main clear (Train 4's default)
THROW(3)              // T3 -> straight-through (unused spur disconnected)
DONE

// ============================================================================
// Trigger routes
// ============================================================================
ROUTE(100, "Start Shuttle")
  SET(2001)           // raise run flag
  RESET(2002)         // alternator: first middle is Train 4
  SENDLOCO(2, 10)     // dispatch Train 2 first
DONE

ROUTE(101, "Stop Shuttle Gracefully")
  RESET(2001)         // current cycle will finish, then no further dispatch
DONE

// ============================================================================
// Train 2 - top track lap
// ============================================================================
//
// Direction convention:
//   FWD = east  (Train 2 starts at the WEST end facing east)
//   REV = west
//
// Sensor reads:
//   East-bound: S1 fires as transit (no AT waiting on it), S2 is the stop.
//   West-bound: S2 fires as transit, S1 is the home stop.
//
// Tuning rationale (these values apply to all three sequences):
//   FWD/REV(40)   Cruise speed. Halved from v1.1.0's 80 for slower, more
//                 deliberate operation on this layout.
//   FWD/REV(20)   Creep speed for the last 8 s before STOP. Halved from
//                 v1.1.0's 40. With halved speed, the creep DELAY had to
//                 grow to maintain a similar distance covered.
//   DELAY(8000)   Creep duration. Long enough that the train moves
//                 COMPLETELY past the sensor beam before stopping --
//                 critical for time-slicing; if the train parks on a beam,
//                 the next sequence's AT() will misfire.
//   DELAYRANDOM(3000, 8000)
//                 Random station dwell. Range tightened from v1.1.0's
//                 8-14 s.

SEQUENCE(10)
  FON(0)              // headlights on for the cycle

  FWD(40)             // depart west home, cruise east on top track
  AT(26)              // wait S2 (far end of top track)
  FWD(20)             // creep
  DELAY(8000)         // glide past S2
  STOP

  DELAYRANDOM(3000, 8000)

  REV(40)             // depart far end, cruise west
  AT(33)              // wait S1 (home end)
  REV(20)
  DELAY(8000)
  STOP

  FOFF(0)             // headlights off, parked at home

  DELAYRANDOM(3000, 8000)

  // Hand off to the middle track. The alternator vpin 2002 picks the next
  // train: active = Train 5, inactive = Train 4. Single top-level IF/ELSE
  // pattern -- no nested IF, no IFNOT (both turned out to be unreliable in
  // EXRAIL 5.6.0 in the v2.0.0-DRAFT-1 attempt).
  //
  // Note: Train 2 ALWAYS dispatches a middle train. The graceful-stop check
  // (vpin 2001) is enforced inside SEQUENCE(20) and SEQUENCE(30) instead.
  // Effect: pressing </START 101> always lets the current cycle finish one
  // more middle-track lap before stopping. That's a natural rest point.
  IF(2002) SENDLOCO(5, 30) ELSE SENDLOCO(4, 20) ENDIF
DONE

// ============================================================================
// Train 4 - middle track lap (no spur involvement)
// ============================================================================
//
// Train 4 starts at the WEST end of the middle track, facing EAST.
// Requires T2 THROWN (middle main clear) and T3 CLOSED (no diversion).
// Both are the default at boot.

SEQUENCE(20)
  THROW(2)            // belt-and-suspenders: ensure T2 didn't drift
  DELAY(2000)         // settle in case the turnout actually moved
  FON(0)

  FWD(40)             // depart west home, cruise east on middle
  AT(26)              // wait S2
  FWD(20)
  DELAY(8000)
  STOP

  DELAYRANDOM(3000, 8000)

  REV(40)
  AT(33)              // wait S1
  REV(20)
  DELAY(8000)
  STOP

  FOFF(0)

  DELAYRANDOM(3000, 8000)

  SET(2002)           // next middle is Train 5
  IF(2001) SENDLOCO(2, 10) ENDIF
DONE

// ============================================================================
// Train 5 - middle track lap with spur entry/exit
// ============================================================================
//
// Train 5 starts on the bottom-left spur, facing EAST. To run a lap:
//   1. CLOSE T2 so the spur connects to the middle main.
//   2. FWD east: Train 5 leaves spur, joins middle track, runs to far end.
//   3. After the dwell, REV west.
//   4. T2 stays closed -- when Train 5 reaches T2 going west, it is
//      diverted onto the spur and stops at home.
//   5. Throw T2 so the middle main is clear for the next Train 4 lap.
//
// Train 5's home-side creep DELAY is intentionally identical to Train 2 /
// Train 4 (8 s) for now, but Train 5 must travel further on the home leg
// because it has to negotiate the T2 points and stop on the spur. If the
// train falls short of the spur, increase only Train 5's home-side
// DELAY(8000) to e.g. 12000 or 15000.

SEQUENCE(30)
  CLOSE(2)            // T2 -> spur position (so T5 can leave the spur)
  DELAY(2000)         // turnout settle
  FON(0)

  FWD(40)             // depart spur, accelerate east on middle
  AT(26)              // wait S2
  FWD(20)
  DELAY(8000)
  STOP

  DELAYRANDOM(3000, 8000)

  REV(40)             // depart east, head west
  AT(33)              // wait S1 (still on middle main; T2 ahead is closed)
  REV(20)             // creep; T2 will divert Train 5 onto the spur
  DELAY(8000)         // tune longer if Train 5 falls short of the spur
  STOP

  FOFF(0)

  THROW(2)            // T2 back to thrown (middle main clear for next T4)

  DELAYRANDOM(3000, 8000)

  RESET(2002)         // next middle is Train 4
  IF(2001) SENDLOCO(2, 10) ENDIF
DONE
