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
//   The cycle is a fixed deterministic chain:
//     T2 -> T4 -> T2 -> T5 -> repeat
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
//   </START 100>          start the shuttle (T2 first, then T4, then T2, then T5, ...)
//   </KILL ALL>           stop everything (graceful stop is TODO; see notes below)
//   <!>                   emergency loco e-stop
//
// SENSOR DECLARATIONS (re-send after every flash)
//   <S 1001 33 0>         S1 (home end of both tracks)
//   <S 1002 26 0>         S2 (far end of both tracks)
//
// EXRAIL 5.6.0 NOTES (learned the hard way on this layout)
//   1. Nested IF (`IF(...) IF(...) ... ENDIF ENDIF`) parses but the inner
//      block does not fire reliably. AVOID.
//   2. SET(vpin) / IF(vpin) on a vpin with no `<S>` declaration appears to
//      use different state tables -- the IF check never sees the SET.
//      The previous DRAFT used SET(2001) / IF(2001) for a graceful-stop
//      flag and SET(2002) / IF(2002) for a middle-train alternator;
//      neither worked end-to-end on this firmware.
//   3. Consequence: this script uses NO virtual flags and NO conditional
//      dispatch.
//   4. SENDLOCO(loco, route) starts a NEW PARALLEL TASK. In bench testing,
//      the first handoff (Train 2 -> Train 4) worked, but the next handoff
//      (Train 4 -> Train 2) did not restart Train 2 reliably. This version
//      avoids SENDLOCO entirely.
//   5. The cycle is now a single deterministic task using FOLLOW(id) as the
//      baton pass. Each sequence explicitly selects its own loco with
//      SETLOCO(...) at the top, then FOLLOWs the next sequence instead of
//      DONE/SENDLOCO.
//   6. Train 2 has TWO sequences (10 and 11) with identical bodies but
//      different terminal FOLLOW targets, which is how the middle-train
//      alternation is encoded.
//   7. Graceful stop is currently a TODO (see open issue). For now, stop
//      with </KILL ALL>.

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
  FOLLOW(10)          // start the single-task chain at Train 2 -> Train 4

// ============================================================================
// Train 2 - top track lap (TWO sequences, identical body)
// ============================================================================
//
// SEQUENCE(10) and SEQUENCE(11) have IDENTICAL bodies. They differ only in
// the final FOLLOW target:
//   SEQUENCE(10) -> FOLLOW(20)   (Train 4 next)
//   SEQUENCE(11) -> FOLLOW(30)   (Train 5 next)
//
// IF YOU TUNE TRAIN 2'S TIMING, EDIT BOTH SEQUENCES TO MATCH.
//
// Direction convention:
//   FWD = east  (Train 2 starts at the WEST end facing east)
//   REV = west
//
// Sensor reads:
//   East-bound: S1 fires as transit (no AT waiting on it), S2 is the stop.
//   West-bound: S2 fires as transit, S1 is the home stop.
//
// Tuning rationale:
//   FWD/REV(40)   Cruise speed. Halved from v1.1.0's 80 for slower, more
//                 deliberate operation on this layout.
//   FWD/REV(20)   Creep speed for the final slowdown before STOP.
//   DELAY(8000)   Creep duration. Long enough that the train clears the
//                 sensor beam before stopping. Critical for time-slicing.
//                 Train 5 uses DELAY(10000) because its spur entry/exit
//                 needs a longer slowdown window.
//   DELAYRANDOM(3000, 8000)
//                 Random station dwell.

SEQUENCE(10)          // === Train 2 lap; dispatches Train 4 ===
  SETLOCO(2)
  FON(0)

  FWD(40)
  AT(26)
  FWD(20)
  DELAY(8000)
  STOP

  DELAYRANDOM(3000, 8000)

  REV(40)
  AT(33)
  REV(20)
  DELAY(8000)
  STOP

  FOFF(0)

  DELAYRANDOM(3000, 8000)

  FOLLOW(20)          // hand off to Train 4 in the same EXRAIL task

SEQUENCE(11)          // === Train 2 lap; dispatches Train 5 (body identical to SEQ 10) ===
  SETLOCO(2)
  FON(0)

  FWD(40)
  AT(26)
  FWD(20)
  DELAY(8000)
  STOP

  DELAYRANDOM(3000, 8000)

  REV(40)
  AT(33)
  REV(20)
  DELAY(8000)
  STOP

  FOFF(0)

  DELAYRANDOM(3000, 8000)

  FOLLOW(30)          // hand off to Train 5 in the same EXRAIL task

// ============================================================================
// Train 4 - middle track lap (no spur involvement)
// ============================================================================
//
// Train 4 starts at the WEST end of the middle track, facing EAST.
// Requires T2 THROWN (middle main clear) and T3 THROWN (no diversion).
// Both are the default at boot.

SEQUENCE(20)
  SETLOCO(4)
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

  FOLLOW(11)          // hand back to Train 2; SEQ 11 will dispatch Train 5 next

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

SEQUENCE(30)
  SETLOCO(5)
  CLOSE(2)            // T2 -> spur position (so T5 can leave the spur)
  DELAY(2000)         // turnout settle
  FON(0)

  FWD(40)             // depart spur, accelerate east on middle
  AT(26)              // wait S2
  FWD(20)
  DELAY(10000)        // Train 5 needs more slowdown time than T2/T4
  STOP

  DELAYRANDOM(3000, 8000)

  REV(40)             // depart east, head west
  AT(33)              // wait S1 (still on middle main; T2 ahead is closed)
  REV(20)             // creep; T2 will divert Train 5 onto the spur
  DELAY(10000)        // longer slowdown for reliable spur entry
  STOP

  FOFF(0)

  THROW(2)            // T2 back to thrown (middle main clear for next T4)

  DELAYRANDOM(3000, 8000)

  FOLLOW(10)          // hand back to Train 2; SEQ 10 will dispatch Train 4 next
