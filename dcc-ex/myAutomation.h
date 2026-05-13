// myAutomation.h - Parallel two-task shuttle with graceful stop (v3.2.0-DRAFT)
//
// LAYOUT (see docs/layout-diagram.md):
//
//   Top track:    -------- (Train 2 lives here, shuttles back and forth)
//                          ^                                ^
//                          | S1 (vpin 33)                   | S2 (vpin 26)
//                          | beam crosses BOTH tracks       | beam crosses BOTH tracks
//                          v                                v
//   Middle track: --T2_t---+--------- T1_t -----------+---T3_t-----
//   Spur (BL):       \--- Train 5 home (off T2_t)
//
// ============================================================================
// v3.2 CHANGES (root-cause fix for "Train 2 goes east then everything stalls")
// ============================================================================
//
// SYMPTOM in v3.1: Train 2 completed its first solo east leg, then the entire
// cycle froze. Train 4 never moved.
//
// ROOT CAUSE: ROUTE(100) used SENDLOCO(4, 200) to spawn the middle task as
// a parallel EXRAIL task. SENDLOCO is the macro Codex specifically flagged
// as UNRELIABLE on this firmware:
//
//     "SENDLOCO(loco, route) starts a NEW PARALLEL TASK. In bench testing,
//      the first handoff (Train 2 -> Train 4) worked, but the next handoff
//      (Train 4 -> Train 2) did not restart Train 2 reliably."
//
// v3.1 assumed a SINGLE startup spawn would be the reliable case. It wasn't.
// The middle task simply didn't materialize, so the top task hit its first
// barrier (SEQ 102) and blocked forever on AT(2011).
//
// FIX (this release): no SENDLOCO anywhere. Instead, BOTH tasks are launched
// by AUTOSTART blocks at boot and each blocks on AT(2002) -- the "go" flag.
// </START 100> SETs 2002, releasing both. </START 110> graceful-stops by
// SETting 2001 and RESETting 2002, so when each task loops back from its
// parking sequence to the gate, it blocks again until the next </START 100>.
//
// THE OTHER EXRAIL FOOTGUNS WE STILL HONOR
//   1. Nested IF (IF inside IF) parses but inner block never fires. AVOID.
//      All conditionals here are single-level IF/IFNOT ... ELSE ... ENDIF.
//   2. SET/IF on UNDECLARED vpins use different state tables (the v1.1.0
//      stop-flag bug). FIXED by HAL(Bitmap, 2000, 20) which makes every
//      vpin 2000..2019 a real software flag readable by IF/IFNOT/AT.
//   3. SENDLOCO is unreliable for parallel-task spawning. Removed entirely.
//   4. Cycle is deterministic per task; no runtime branching beyond the
//      home-arrival stop check and the partner-parked barrier bypass.
//
// ============================================================================
// ARCHITECTURE (parallel two-task shuttle)
// ============================================================================
//
//   - Top task:    Train 2 forever on the top track.
//   - Middle task: alternates Train 4 / Train 5 on the middle track.
//
//   Trains run OPPOSITE directions and pass in the middle. Direction phase
//   is held by a 4-phase rendezvous barrier between every leg
//   (SET own, AT partner, RESET own, AT(-) partner). Whoever finishes its
//   random dwell first waits; both depart together.
//
// SENSOR AMBIGUITY HANDLING
//   S1/S2 beams cross both tracks. Two ambiguities:
//     1. DEPARTURE: each leg begins with DELAY(8000) before AT() so the
//        partner's departure transit clears the shared beam first.
//     2. ARRIVAL: trains always run opposite directions, so arrival sensors
//        differ (top east + mid west -> top arrives at S2, mid at S1).
//
// STARTUP STAGGER
//   All three trains start at WEST. Train 2 runs ONE solo east leg (SEQ 101)
//   while the middle task spawns and blocks at the first barrier. From the
//   next leg onward they cross every time.
//
// ============================================================================
// GRACEFUL STOP DESIGN
// ============================================================================
//
//   </START 110> SETs 2001 and RESETs 2002. Each task checks IF(2001) ONLY
//   at its HOME arrival (Train 2: end of SEQ 102; middle: end of SEQ 202 for
//   T4 or 204 for T5) and routes to its parking sequence. The parking
//   sequence then FOLLOWs back to the wait-gate (SEQ 120 / 220), where the
//   task blocks on AT(2002) until the next </START 100>.
//
//   Asymmetric park: at any instant one task is "home" and the other is
//   "away," so they park on different legs. Whichever parks first SETs its
//   parked flag (2012 top / 2013 mid); the other train still owes one return
//   leg. Two cooperating mechanisms prevent the survivor from deadlocking:
//
//     a) BARRIER BYPASS. Each barrier is wrapped in IFNOT(partner_parked) ...
//        ENDIF. If the partner has latched its parked flag, skip the barrier
//        and run the leg solo.
//     b) PARKING BARRIER FINALIZE. The parking sequence SETs its ready flag,
//        DELAYs 500 ms, then RESETs. This unblocks a partner that was already
//        mid-AT in the current barrier when we parked (the race window
//        between the partner's IFNOT(2012/2013) check and its AT(...) call).
//
//   Either mechanism alone covers most timings; together they cover all.
//
// ============================================================================
// VIRTUAL VPIN ALLOCATION (HAL-declared bitmap; SET/RESET/IF/IFNOT/AT share state)
// ============================================================================
//
//   2001 - stop flag         SET by ROUTE(110), RESET by ROUTE(100)
//   2002 - go flag           SET by ROUTE(100), RESET by ROUTE(110) and at boot.
//                            Both task entry sequences AT-wait on this.
//   2010 - top_ready         barrier flag raised by top task
//   2011 - mid_ready         barrier flag raised by middle task
//   2012 - top_parked        latched by SEQ 150 once Train 2 has parked
//   2013 - mid_parked        latched by SEQ 250 once middle train has parked
//
// ============================================================================
// TURNOUT POLICY (decoders inverted: THROWN = main, CLOSED = diverging)
// ============================================================================
//   T1_t (addr 1, double-slip)  THROWN always. Top/middle stay parallel.
//   T2_t (addr 2, left-hand)    THROWN for T4 lap, CLOSED for T5 lap.
//   T3_t (addr 3, right-hand)   THROWN always.
//
// ============================================================================
// CONTROL
// ============================================================================
//   Pre-start: Train 2 at top-west home, Train 4 at middle-west home,
//   Train 5 on the BL spur.
//
//     </START 100>   start (or restart) parallel shuttle
//     </START 110>   graceful stop (both trains return home, then halt)
//     </KILL ALL>    hard stop -- terminates every EXRAIL task immediately
//     <!>            emergency loco e-stop
//
// SENSOR DECLARATIONS (re-send after every flash)
//   <S 1001 33 0>  S1 (home end, both tracks)
//   <S 1002 26 0>  S2 (far end, both tracks)
//
// The 2000-series vpins are materialized by HAL(Bitmap, 2000, 20) below.

// ============================================================================
// HAL: declare bitmap vpins so SET/RESET/IF/IFNOT/AT share state
// ============================================================================
HAL(Bitmap, 2000, 20)

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
// Boot setup: power on, set turnouts to defaults, clear every flag vpin
// ============================================================================
AUTOSTART
POWERON
THROW(1)
THROW(2)
THROW(3)
RESET(2001)
RESET(2002)
RESET(2010)
RESET(2011)
RESET(2012)
RESET(2013)
DONE

// ============================================================================
// Task entries (AUTOSTART, no SENDLOCO)
// ============================================================================
//
// Each task spawns at boot and blocks on AT(2002) inside its wait-gate
// sequence. </START 100> releases the gate; parking sequences FOLLOW back
// to the gate for clean restart.

AUTOSTART
  FOLLOW(120)             // top task entry
DONE

AUTOSTART
  FOLLOW(220)             // middle task entry
DONE

// ============================================================================
// Trigger routes
// ============================================================================

ROUTE(100, "Start Parallel Shuttle")
  RESET(2001)             // clear stop flag
  RESET(2010)             // clear all barrier flags
  RESET(2011)
  RESET(2012)             // clear parked flags
  RESET(2013)
  SET(2002)               // release both task gates

ROUTE(110, "Stop Shuttle Gracefully")
  SET(2001)               // tell tasks to park at next home arrival
  RESET(2002)             // close the gate so parked tasks block on re-entry

// ============================================================================
// TOP TASK: Train 2 on the top track, forever
// ============================================================================
//
// Direction convention: FWD = east, REV = west. Train 2 home is WEST.
//
// 120 (wait-gate)               -> blocks until </START 100>
// 101 (first east leg, solo)    -> no barrier (mid is still gated/staging)
// 102 (west leg, home arrival)  -> stop check here
// 103 (east leg, away arrival)  -> no stop check; always FOLLOW(102)
// 150 (parking)                 -> entered from 102 when stop flag set

SEQUENCE(120)               // === wait-gate; blocks until </START 100> ===
  SETLOCO(2)
  AT(2002)
  FON(0)
  FOLLOW(101)

SEQUENCE(101)               // === first east leg (solo; mid is at first barrier) ===
  SETLOCO(2)
  FWD(40)
  AT(26)                    // S2 arrival -- middle hasn't moved yet, no ambiguity
  FWD(20)
  DELAY(8000)
  STOP
  DELAYRANDOM(3000, 8000)
  FOLLOW(102)

SEQUENCE(102)               // === west leg (Train 2 returning home; mid going east) ===
  SETLOCO(2)
  IFNOT(2013)               // skip barrier if mid has parked
    SET(2010)
    AT(2011)
    RESET(2010)
    AT(-2011)
  ENDIF
  REV(40)
  DELAY(8000)               // mask middle's east-departure transit across S1
  AT(33)                    // S1 arrival
  REV(20)
  DELAY(8000)
  STOP
  DELAYRANDOM(3000, 8000)
  IF(2001)                  // stop flag set -> park at home (top is at west now)
    FOLLOW(150)
  ELSE
    FOLLOW(103)
  ENDIF

SEQUENCE(103)               // === east leg (Train 2 going away; mid going west) ===
  SETLOCO(2)
  IFNOT(2013)               // skip barrier if mid has parked
    SET(2010)
    AT(2011)
    RESET(2010)
    AT(-2011)
  ENDIF
  FWD(40)
  DELAY(8000)               // mask middle's west-departure transit across S2
  AT(26)                    // S2 arrival
  FWD(20)
  DELAY(8000)
  STOP
  DELAYRANDOM(3000, 8000)
  FOLLOW(102)               // never park here (top is at east, not home)

SEQUENCE(150)               // === top parking: lights off, finalize barrier, loop ===
  SETLOCO(2)
  FOFF(0)
  SET(2012)                 // tell mid: top is parked, skip future barriers
  SET(2010)                 // unblock any partner currently in AT(2010)
  DELAY(500)
  RESET(2010)
  FOLLOW(120)               // back to wait-gate (task stays alive for restart)

// ============================================================================
// MIDDLE TASK: alternates Train 4 lap and Train 5 lap, forever
// ============================================================================
//
// 220 (wait-gate)               -> blocks until </START 100>
// 200 (turnout setup + lights)  -> runs once after each gate release
// 201 = T4 east leg (away), 202 = T4 west leg (home) -> stop check here
// 203 = T5 east leg (away), 204 = T5 west leg (home) -> stop check here
// 250 = mid parking (entered from 202 or 204 when stop flag set)

SEQUENCE(220)               // === wait-gate; blocks until </START 100> ===
  SETLOCO(4)
  AT(2002)
  FOLLOW(200)

SEQUENCE(200)               // === middle-task setup: turnout, headlights ===
  SETLOCO(4)
  THROW(2)                  // T2_t thrown -- middle main clear for T4
  DELAY(2000)
  FON(0)
  FOLLOW(201)

SEQUENCE(201)               // === T4 east leg (Train 2 going west) ===
  SETLOCO(4)
  THROW(2)                  // re-assert after a T5 -> T4 transition
  IFNOT(2012)               // skip barrier if top has parked
    SET(2011)
    AT(2010)
    RESET(2011)
    AT(-2010)
  ENDIF
  FWD(40)
  DELAY(8000)               // mask Train 2's west-departure transit across S2
  AT(26)                    // S2 arrival
  FWD(20)
  DELAY(8000)
  STOP
  DELAYRANDOM(3000, 8000)
  FOLLOW(202)               // never park here (mid is at east, not home)

SEQUENCE(202)               // === T4 west leg (Train 2 going east) ===
  SETLOCO(4)
  IFNOT(2012)
    SET(2011)
    AT(2010)
    RESET(2011)
    AT(-2010)
  ENDIF
  REV(40)
  DELAY(8000)               // mask Train 2's east-departure transit across S1
  AT(33)                    // S1 arrival
  REV(20)
  DELAY(8000)
  STOP
  DELAYRANDOM(3000, 8000)
  IF(2001)                  // stop flag set -> park at home (T4 is at west now)
    FOLLOW(250)
  ELSE
    FOLLOW(203)
  ENDIF

SEQUENCE(203)               // === T5 east leg: leaves spur, runs to east end ===
  SETLOCO(5)
  CLOSE(2)                  // T2_t -> spur position
  DELAY(2000)
  FON(0)
  IFNOT(2012)
    SET(2011)
    AT(2010)
    RESET(2011)
    AT(-2010)
  ENDIF
  FWD(40)
  DELAY(8000)
  AT(26)                    // S2 arrival
  FWD(20)
  DELAY(10000)              // longer creep -- spur exit transition
  STOP
  DELAYRANDOM(3000, 8000)
  FOLLOW(204)               // never park here (T5 is at east, not home)

SEQUENCE(204)               // === T5 west leg: returns to spur via still-CLOSED T2_t ===
  SETLOCO(5)
  IFNOT(2012)
    SET(2011)
    AT(2010)
    RESET(2011)
    AT(-2010)
  ENDIF
  REV(40)
  DELAY(8000)
  AT(33)                    // S1 arrival
  REV(20)
  DELAY(10000)              // longer creep -- spur entry transition
  STOP
  FOFF(0)
  THROW(2)                  // restore main clear for the next T4 lap
  DELAYRANDOM(3000, 8000)
  IF(2001)                  // stop flag set -> park (T5 is on spur now)
    FOLLOW(250)
  ELSE
    FOLLOW(201)
  ENDIF

SEQUENCE(250)               // === mid parking: lights off, finalize barrier, loop ===
  SETLOCO(4)                // turn T4 lights off (was on continuously since SEQ 200)
  FOFF(0)
  SETLOCO(5)                // turn T5 lights off (already off from SEQ 204 path, harmless)
  FOFF(0)
  SET(2013)                 // tell top: mid is parked, skip future barriers
  SET(2011)                 // unblock any partner currently in AT(2011)
  DELAY(500)
  RESET(2011)
  FOLLOW(220)               // back to wait-gate (task stays alive for restart)
