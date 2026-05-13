// myAutomation.h - Parallel two-task shuttle with graceful stop (v3.7.0-DRAFT)
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
// v3.7 CHANGES (avoid blind S2 arrival delay)
// ============================================================================
//
// SYMPTOM in v3.3/v3.4/v3.5: </START 100> makes Train 2 run left-to-right, then
// the program stalls at SEQ 102's AT(2011). The middle task never reaches
// SEQ 201 far enough to SET(2011).
//
// HISTORY OF SPAWN ATTEMPTS:
//   v3.1: ROUTE(100) used SENDLOCO(4, 200) to spawn the middle task.
//         Codex's notes explicitly flagged SENDLOCO as unreliable for
//         multi-hop parallel spawning. A single startup spawn turns out to
//         be unreliable too.
//   v3.2: Three AUTOSTART blocks (boot setup + top gate + middle gate).
//         The official DCC-EX docs do not document multi-AUTOSTART behavior
//         on 5.6.0, and on this firmware only the FIRST AUTOSTART block
//         actually starts a task -- the second and third blocks chain onto
//         the first task as straight-line code, so they "hijack" the boot
//         task instead of spawning new ones. Net effect: only one task runs.
//
//   v3.3: drop multi-AUTOSTART and SENDLOCO entirely. Use the
//   one spawn mechanism Codex's working v2.0 proved out: each </START N>
//   command spawns a new parallel EXRAIL task. This worked only if the user
//   manually invoked TWO trigger routes:
//
//       </START 100>     spawn the top task    (Train 2 on the top track)
//       </START 200>     spawn the middle task (Train 4 / Train 5 alternating)
//
//   v3.4: make </START 100> the single normal start command. ROUTE(100)
//   used two documented EXRAIL START(id) calls:
//
//       START(101)       top task
//       START(220)       middle task
//
//   Bench result: Train 2 started, but the middle task still did not. This
//   suggests this firmware either does not honor the second START() inside
//   one route, or the first START() yields/ends the route before the second
//   one runs.
//
//   v3.5: use only ONE spawned task. ROUTE(100) does:
//
//       START(220)       spawn middle task
//       FOLLOW(101)      current route task becomes the top task
//
//   This leaves Train 2 in the normal </START 100> route task and uses
//   START only for the one extra concurrent task we actually need.
//
//   Bench result: still stalled. Diagnostic </START 290> (SET 2011) released
//   Train 2, proving the bitmap barrier works and the middle task still was
//   not starting.
//
//   v3.6: route 100 now starts ROUTE(200), not SEQUENCE(220):
//
//       START(200)       spawn "DEBUG: Start Middle Only" route
//       FOLLOW(101)      current route task becomes the top task
//
//   ROUTE(200) immediately FOLLOWs SEQUENCE(220). This mirrors the external
//   command path (`</START 200>`) that DCC-EX already knows how to spawn.
//
//   Bench result: startup finally worked. Train 2 ran east, then Train 2 west
//   and Train 4 east ran together as intended. Train 4 then overran the east
//   end because it reached S2 while its sequence was still inside the
//   8-second blind mask before AT(26).
//
//   v3.7 (this release): remove the blind pre-AT delay on S2 approaches that
//   are short enough to overrun. The approaching train now waits for S2 to
//   clear with AT(-26), starts moving, and immediately arms AT(26).
//
// THE OTHER EXRAIL FOOTGUNS WE STILL HONOR
//   1. Nested IF (IF inside IF) parses but the inner block never fires.
//      All conditionals here are single-level IF/IFNOT ... ELSE ... ENDIF.
//   2. SET/IF on UNDECLARED vpins use different state tables (the v1.1.0
//      stop-flag bug). FIXED by HAL(Bitmap, 2000, 20) which makes vpins
//      2000..2019 real software flags shared across tasks for SET/IF/AT.
//   3. SENDLOCO is unreliable for parallel-task spawning. Removed.
//   4. Multi-AUTOSTART does not actually spawn separate tasks here. Removed.
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
//   Both routes can be invoked in any order. The top task runs ONE solo
//   east leg (SEQ 101) while the middle task spawns and blocks at the first
//   barrier. From the next leg onward they cross every time.
//
// ============================================================================
// GRACEFUL STOP DESIGN
// ============================================================================
//
//   </START 110> SETs the stop flag (vpin 2001). Each task checks IF(2001)
//   ONLY at its HOME arrival (Train 2: end of SEQ 102; middle: end of SEQ 202
//   for T4 or 204 for T5) and routes to its parking sequence. The parking
//   sequence kills the lights, latches its parked flag, finalizes the
//   partner's barrier (in case the partner was already mid-AT), and ends.
//
//   Restart after a graceful stop: send </START 100> again. ROUTE(100)
//   clears the stale flags, spawns the middle route, and continues as the
//   top task, so the new run begins from a clean state.
//
//   Asymmetric park: at any instant one task is "home" and the other is
//   "away," so they park on different legs. Whichever parks first SETs its
//   parked flag (2012 top / 2013 mid); the other train still owes one
//   return leg. Two cooperating mechanisms prevent the survivor from
//   deadlocking on that solo return:
//
//     a) BARRIER BYPASS. Each barrier is wrapped in IFNOT(partner_parked).
//        If the partner has latched its parked flag, skip the barrier and
//        run the leg solo.
//     b) PARKING BARRIER FINALIZE. The parking sequence SETs its ready flag,
//        DELAYs 500 ms, then RESETs. This unblocks a partner that was
//        already mid-AT in the current barrier when we parked (the race
//        window between the partner's IFNOT check and its AT call).
//
//   Either mechanism alone covers most timings; together they cover all.
//
// ============================================================================
// VIRTUAL VPIN ALLOCATION (HAL-declared bitmap; SET/RESET/IF/IFNOT/AT share state)
// ============================================================================
//
//   2001 - stop flag         SET by ROUTE(110), RESET by ROUTE(100)
//   2010 - top_ready         barrier flag raised by top task
//   2011 - mid_ready         barrier flag raised by middle task
//   2012 - top_parked        latched by SEQ 150 once Train 2 has parked
//   2013 - mid_parked        latched by SEQ 250 once middle train has parked
//
// SHARED-BEAM MOTION RULE
//   Do not use a long blind DELAY before arming AT() on a short approach.
//   If the train reaches the beam during the delay, the event is missed and
//   the train runs through the stop point. For the train approaching a beam
//   the partner just occupied, wait for that beam to clear first:
//
//     AT(-26)    // wait until S2 is clear
//     FWD(40)
//     AT(26)     // immediately listen for this train's S2 arrival
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
//     </START 100>   start full shuttle: spawn top + middle tasks
//     </START 200>   diagnostic only: spawn middle task by itself
//     </START 290>   diagnostic only: pulse mid_ready (2011) for 1 second
//     </START 110>   graceful stop (both trains return home, then halt)
//     </KILL ALL>    hard stop -- terminates every EXRAIL task immediately
//     <!>            emergency loco e-stop
//
//   Normal operation: send ONLY 100. To restart after a graceful stop, send
//   100 again.
//
// SENSOR DECLARATIONS (re-send after every flash)
//   <S 1001 33 0>  S1 (home end, both tracks)
//   <S 1002 26 0>  S2 (far end, both tracks)

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
// Boot setup: power on and set turnouts to defaults
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
// </START 100> is the single normal start command. It clears stale flags,
// spawns ROUTE(200) for the middle task, then continues as the top task.

ROUTE(100, "Start Shuttle")
  RESET(2001)             // clear stop flag from any previous run
  RESET(2010)             // clear barrier and parked flags
  RESET(2011)
  RESET(2012)
  RESET(2013)
  START(200)              // spawn middle route, which FOLLOWs SEQ 220
  FOLLOW(101)             // current route task becomes top task (Train 2)

ROUTE(200, "DEBUG: Start Middle Only")
  FOLLOW(220)             // diagnostic only; do not use for normal startup

ROUTE(290, "DEBUG: Pulse Mid Ready")
  SET(2011)               // if top is waiting at AT(2011), this should release it
  DELAY(1000)
  RESET(2011)
DONE

ROUTE(110, "Stop Shuttle Gracefully")
  SET(2001)
DONE

// ============================================================================
// TOP TASK: Train 2 on the top track
// ============================================================================
//
// Direction convention: FWD = east, REV = west. Train 2 home is WEST.
//
// 101 (first east leg, solo)    -> no barrier (mid is at first barrier)
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
  AT(-26)                   // wait until middle train has cleared S2
  FWD(40)
  AT(26)                    // S2 arrival
  FWD(20)
  DELAY(8000)
  STOP
  DELAYRANDOM(3000, 8000)
  FOLLOW(102)               // never park here (top is at east, not home)

SEQUENCE(150)               // === top parking: lights off, finalize barrier, end ===
  SETLOCO(2)
  FOFF(0)
  SET(2012)                 // tell mid: top is parked, skip future barriers
  SET(2010)                 // unblock any partner currently in AT(2010)
  DELAY(500)
  RESET(2010)
  // task ends; restart by sending </START 100> again
DONE

// ============================================================================
// MIDDLE TASK: alternates Train 4 lap and Train 5 lap
// ============================================================================
//
// 220 (turnout setup + lights)  -> runs once at each full shuttle start
// 201 = T4 east leg (away), 202 = T4 west leg (home)  -> stop check here
// 203 = T5 east leg (away), 204 = T5 west leg (home)  -> stop check here
// 250 = mid parking (entered from 202 or 204 when stop flag set)

SEQUENCE(220)               // === middle-task setup: turnout, headlights ===
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
  AT(-26)                   // wait until Train 2 has cleared S2
  FWD(40)
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
  AT(-26)                   // wait until Train 2 has cleared S2
  FWD(40)
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

SEQUENCE(250)               // === mid parking: lights off, finalize barrier, end ===
  SETLOCO(4)
  FOFF(0)                   // T4 lights off (was on continuously since SEQ 220)
  SETLOCO(5)
  FOFF(0)                   // T5 lights off (already off if parking from 204)
  SET(2013)                 // tell top: mid is parked, skip future barriers
  SET(2011)                 // unblock any partner currently in AT(2011)
  DELAY(500)
  RESET(2011)
  // task ends; restart by sending </START 100> again
DONE
