// myAutomation.h - Parallel two-task shuttle with graceful stop (v3.1.0-DRAFT)
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
// v3.1 CHANGES (graceful stop, the right way)
// ============================================================================
//
// Adds </START 101> graceful stop. Both trains complete a coordinated final
// half-cycle and park at their HOME positions (Train 2 at top-west,
// Train 4 at middle-west, Train 5 back on the BL spur), with headlights off.
// To restart: </START 100>.
//
// THE EXRAIL FLAG BUG THIS RELEASE FINALLY FIXES
//   v1.1.0 tried a stop flag with SET(2001) / IF(2001) and it never worked --
//   the IF check always saw 0. v3.0 used SET(2010) / AT(2011) for the barrier
//   and worked on the bench, but we never verified the IF path.
//
//   Per the DCC-EX docs (cookbooks/flags-and-latches/flags.html and
//   reference/software/command-summary-consolidated.html):
//
//     * SET/RESET drive OUTPUT state.
//     * IF/IFNOT read SENSOR/INPUT state.
//     * AT/AFTER also operate on sensor state.
//
//   On an undeclared vpin these are DIFFERENT state tables -- which is why
//   v1.1.0 silently misbehaved. A vpin only becomes a "real" software flag
//   visible to both sides when declared with:
//
//     HAL(Bitmap, firstpin, npins)
//
//   Bitmap pins are explicitly documented as "software flags... used as
//   INPUT and OUTPUT... flags between EXRAIL processes." We declare a block
//   of 14 vpins (2000..2013) up front and use them with confidence.
//
// ============================================================================
// ARCHITECTURE (parallel two-task shuttle, unchanged from v3.0)
// ============================================================================
//
//   - Top task:    Train 2 forever on the top track.
//   - Middle task: alternates Train 4 / Train 5 on the middle track.
//
//   Trains run OPPOSITE directions and pass in the middle. Direction phase
//   is held by a 4-phase rendezvous barrier between every leg (SET own,
//   AT partner, RESET own, AT(-) partner). Whoever finishes its random
//   dwell first waits; both depart together.
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
// GRACEFUL STOP DESIGN (the deadlock-safe part)
// ============================================================================
//
//   </START 101> SETs the stop flag (vpin 2001). Each task checks 2001
//   ONLY at its HOME arrival (Train 2: end of SEQ 102; middle: end of SEQ 202
//   for T4 or 204 for T5). At HOME, IF(2001) -> FOLLOW(parking).
//
//   This is asymmetric: at any moment one task is "home" and the other is
//   "away." Whichever parks first SETs its parked flag (2012 for top,
//   2013 for mid). The OTHER task still owes one return leg.
//
//   The remaining train would normally deadlock on its next barrier because
//   its partner is gone. Two mechanisms together prevent the deadlock:
//
//     a) BARRIER BYPASS. Each barrier is wrapped in IFNOT(partner_parked) ...
//        ENDIF. If the partner is parked, skip the barrier and run solo.
//     b) PARKING BARRIER FINALIZE. The parking sequence SETs its ready flag
//        and waits 500 ms before RESET. This unblocks a partner that was
//        ALREADY waiting in the current barrier when we parked (the small
//        race window between the partner's IFNOT check and its SET()).
//
//   Either (a) or (b) saves the solo train depending on its timing relative
//   to when parking happens. Both together cover all races.
//
//   Restart: </START 100> RESETs every flag (stop, barrier, parked) so a
//   clean run can begin again.
//
// ============================================================================
// VIRTUAL VPIN ALLOCATION (HAL-declared as Bitmap; SET/RESET/IF/IFNOT/AT all
// share state)
// ============================================================================
//
//   2001 - stop flag         SET by ROUTE(101), RESET by ROUTE(100)
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
//     </START 101>   graceful stop (both trains return home, then halt)
//     </KILL ALL>    hard stop -- terminates every EXRAIL task immediately
//     <!>            emergency loco e-stop
//
// SENSOR DECLARATIONS (re-send after every flash)
//   <S 1001 33 0>  S1 (home end, both tracks)
//   <S 1002 26 0>  S2 (far end, both tracks)
//
// The 2000-series vpins do NOT need <S> declarations -- they are created by
// the HAL(Bitmap,...) line below.

// ============================================================================
// HAL: declare bitmap vpins so SET/RESET/IF/IFNOT/AT share state
// ============================================================================
HAL(Bitmap, 2000, 14)

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
// Boot setup: power on, set turnouts to defaults, clear all flag vpins
// ============================================================================
AUTOSTART
POWERON
THROW(1)
THROW(2)
THROW(3)
RESET(2001)
RESET(2010)
RESET(2011)
RESET(2012)
RESET(2013)
DONE

// ============================================================================
// Trigger routes
// ============================================================================
//
// ROUTE(100) clears every flag before spawning the two tasks, so a restart
// after a graceful stop begins from a clean state. ROUTE(101) just SETs the
// stop flag; the running tasks observe it at their next home-arrival check.

ROUTE(100, "Start Parallel Shuttle")
  RESET(2001)
  RESET(2010)
  RESET(2011)
  RESET(2012)
  RESET(2013)
  SENDLOCO(4, 200)        // spawn middle task (one-shot startup spawn)
  FOLLOW(101)             // continue as top task (Train 2 first east leg)

ROUTE(101, "Stop Shuttle Gracefully")
  SET(2001)

// ============================================================================
// TOP TASK: Train 2 on the top track, forever
// ============================================================================
//
// Direction convention: FWD = east, REV = west. Train 2 home is WEST.
//
// 102 (west leg, home arrival)  -> stop check here
// 103 (east leg, away arrival)  -> no stop check; always FOLLOW(102)
// 150 (parking)                 -> entered from 102 when stop flag set

SEQUENCE(101)               // === first east leg (solo; mid is at first barrier) ===
  SETLOCO(2)
  FON(0)
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

SEQUENCE(150)               // === top parking: lights off, finalize partner's barrier ===
  SETLOCO(2)
  FOFF(0)
  SET(2012)                 // tell mid: top is parked, skip future barriers
  SET(2010)                 // unblock any partner currently in AT(2010)
  DELAY(500)
  RESET(2010)
  // task ends (no FOLLOW)

// ============================================================================
// MIDDLE TASK: alternates Train 4 lap and Train 5 lap, forever
// ============================================================================
//
// 200 -> 201 -> 202 -> 203 -> 204 -> 201 -> ...
// 201 = T4 east leg (away), 202 = T4 west leg (home) -> stop check here
// 203 = T5 east leg (away), 204 = T5 west leg (home) -> stop check here
// 250 = mid parking (entered from 202 or 204 when stop flag set)

SEQUENCE(200)               // === middle-task entry: turnout setup, headlights ===
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

SEQUENCE(250)               // === mid parking: lights off, finalize partner's barrier ===
  FOFF(0)                   // T4 still on if parking from 202; T5 already off from 204
  SET(2013)                 // tell top: mid is parked, skip future barriers
  SET(2011)                 // unblock any partner currently in AT(2011)
  DELAY(500)
  RESET(2011)
  // task ends (no FOLLOW)
