// myAutomation.h - Parallel two-task shuttle with graceful stop (v3.17.0)
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
//   Bench result: deadlock. Train 4 was waiting for S2 to clear, but Train 2
//   was still parked on/near S2 and had not yet started westbound.
//
//   v3.8 (this release): for the Train 2 west / middle east phase, the middle
//   task stages at its barrier while Train 2 starts westbound first. Train 2
//   waits until it has cleared S2, then releases the middle task. The middle
//   task then starts eastbound and arms AT(26) immediately.
//
//   Bench result: both trains did start in opposite directions, but each
//   immediately saw its DEPARTURE beam as an arrival event: Train 2 tripped S2
//   while leaving the east end; Train 4 tripped S1 while leaving the west end.
//
//   v3.9 (this release): every movement leg now uses AFTER(departure_sensor)
//   before arming AT(arrival_sensor). Per the official EXRAIL docs, AFTER waits
//   until the sensor has triggered and then gone off for 0.5 seconds. That lets
//   a beam-break sensor act as both departure and arrival sensor without the
//   train treating its own departure as its destination.
//
//   Bench result: first coordinated crossing worked, then both trains stopped:
//   Train 2 at west/S1 and Train 4 at east/S2. The next symmetric barrier
//   deadlocked and, more importantly, Train 2 must not arm S2 while Train 4 is
//   still sitting on S2.
//
//   v3.10 (this release): the return phase is now staged too. Train 4/5 waits
//   at S2, Train 2 starts eastbound first and clears S1, then releases the
//   middle train westbound. Train 2 waits for the middle train to clear S2
//   before arming AT(26) as its arrival sensor.
//
//   Bench result: Train 2 and Train 4 crossed too close to S2, creating one
//   continuous S2 beam interruption. Train 2 never saw a separate S2 arrival
//   and overran the east end.
//
//   v3.11: reverse the staging for that return phase. Train
//   4/5 leaves S2 first, S2 clears, then Train 2 departs S1 shortly after.
//   This gives S2 a clean off/on gap before Train 2 reaches it.
//
//   Bench result: first crossing still had S1 overlap because Train 4 left
//   west/S1 too late; return crossing had S1 false-arrival because Train 2
//   left west/S1 after Train 4 had already armed AT(33).
//
//   v3.12:
//     - First crossing: release Train 4/5 earlier, shortly after Train 2
//       starts westbound instead of waiting for Train 2 to fully clear S2.
//     - Return crossing: Train 2 departs sooner after Train 4/5 clears S2,
//       and Train 4/5 explicitly AFTER(33)s Train 2's S1 departure before
//       arming AT(33).
//
//   Bench result: any intentional departure offset can make one train cross
//   a shared beam while the other train is still using it, collapsing two
//   beam breaks into one continuous sensor event.
//
//   v3.13 (this release): remove intentional departure delays from both
//   coordinated crossings. The trains now depart as close together as EXRAIL's
//   two task scheduler allows. We still use AFTER(...) gates to consume the
//   departure beam breaks before arming arrival sensors.
//
//   Bench result: trains departed together cleanly, but some legs still blew
//   past the station. Root cause: the script still had "partner departure"
//   AFTER(...) waits. If the partner had already cleared that beam, AFTER()
//   consumed the NEXT trigger -- the train's real arrival -- and AT(...) armed
//   too late.
//
//   v3.14 (this release): remove partner-departure AFTER(...) waits. Each leg
//   now consumes ONLY its own departure beam, then immediately arms the
//   opposite arrival beam.
//
//   Bench result: Train 5's west-to-east departure from the spur can hit S1
//   late enough that Train 2 has already armed AT(33) for its east-to-west
//   home arrival. Train 2 then treats Train 5's S1 departure as its own
//   arrival and stops early.
//
//   v3.15 (this release): add a software handshake for middle-train S1
//   departure clear. The middle task SETs vpin 2014 after Train 4/5 has
//   completed AFTER(33). Train 2 waits for 2014 before arming AT(33).
//
//   Bench result: mirrored issue at S2 during Train 5's first westbound return.
//   Train 5's S2 departure was being seen as Train 2's S2 arrival.
//
//   v3.16 (this release): add the mirrored software handshake for S2. The
//   middle task SETs vpin 2015 after Train 4/5 has completed AFTER(26).
//   Train 2 waits for 2015 before arming AT(26).
//
//   Bench result: confirmed working on the physical layout. Promote v3.16 as
//   the current stable script.
//
//   v3.17: add explicit T2 route-lock delays before Train 5 moves. Field
//   observation: Train 5 could begin moving before T2 had visibly completed
//   its CLOSED/spur movement. The fix reasserts T2 CLOSED and waits before
//   the middle task raises 2011, so Train 2 stays parked during the turnout
//   settle period and shared-beam timing is not disturbed.
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
//   is held by staged rendezvous barriers:
//     - Westbound top / eastbound middle: Train 2 leaves S2 first, then
//       releases the middle train after S2 clears.
//     - Eastbound top / westbound middle: middle train leaves S2 first, then
//       Train 2 leaves S1 after S2 has had a clean clear interval.
//
// SENSOR AMBIGUITY HANDLING
//   S1/S2 beams cross both tracks. Every leg must consume its own departure
//   beam break with AFTER(departure_sensor) before arming AT(arrival_sensor).
//   Where both trains share S2 at the phase change, staged release creates a
//   clean off/on gap so the RIR4 can see two separate beam-break events.
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
//   partner's barrier (in case the partner was already mid-AT), restores
//   turnouts to the startup state, and ends.
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
//   2010 - top_ready/release  barrier flag raised by top task
//   2011 - mid_ready          barrier flag raised by middle task
//   2012 - top_parked        latched by SEQ 150 once Train 2 has parked
//   2013 - mid_parked        latched by SEQ 250 once middle train has parked
//   2014 - mid_s1_clear      SET by middle task after S1 departure clears
//   2015 - mid_s2_clear      SET by middle task after S2 departure clears
//
// SHARED-BEAM MOTION RULE
//   S1/S2 are beam-breaks across BOTH tracks. Every leg must ignore its
//   departure beam before listening for its arrival beam:
//
//     Eastbound:  FWD(40), AFTER(33), AT(26), creep, STOP
//     Westbound:  REV(40), AFTER(26), AT(33), creep, STOP
//
//   AFTER(...) is only used for the train's OWN departure beam. Do not use it
//   for a partner train's departure: if that departure already cleared, AFTER()
//   can consume this train's real station arrival and cause an overrun.
//
// ============================================================================
// TURNOUT POLICY (decoders inverted: THROWN = main, CLOSED = diverging)
// ============================================================================
//   T1_t (addr 1, double-slip)  THROWN always. Top/middle stay parallel.
//   T2_t (addr 2, left-hand)    THROWN for T4 lap, CLOSED for T5 lap.
//   T3_t (addr 3, right-hand)   THROWN always.
//
//   T2 route-lock rule: assert the route, wait briefly, assert it again, then
//   wait for the turnout to physically settle BEFORE setting the 2011 ready
//   barrier. That keeps the partner train stopped while T2 is moving.
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
RESET(2014)
RESET(2015)
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
  RESET(2014)
  RESET(2015)
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
  AFTER(33)                 // ignore Train 2's S1 departure beam break
  AT(26)                    // S2 arrival -- middle hasn't moved yet, no ambiguity
  FWD(20)
  DELAY(8000)
  STOP
  DELAYRANDOM(3000, 8000)
  FOLLOW(102)

SEQUENCE(102)               // === west leg (Train 2 returning home; mid going east) ===
  SETLOCO(2)
  IFNOT(2013)               // skip barrier if mid has parked
    AT(2011)                // middle staged and waiting for top to clear S2
  ENDIF
  REV(40)
  IFNOT(2013)
    RESET(2014)             // wait for active middle train to clear S1
    SET(2010)               // release middle eastbound leg immediately
    AT(-2011)               // wait until middle acknowledges by dropping ready
    RESET(2010)
  ENDIF
  AFTER(26)                 // ignore Train 2's S2 departure beam break
  IFNOT(2013)
    AT(2014)                // middle train has consumed/cleared S1 departure
    RESET(2014)
  ENDIF
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
    AT(2011)                // middle staged and waiting for top to clear S1
    RESET(2015)             // wait for active middle train to clear S2
    FWD(40)                 // start Train 2 immediately
    SET(2010)               // release middle westbound leg immediately
    AT(-2011)               // wait until middle acknowledges by dropping ready
    RESET(2010)
  ELSE
    FWD(40)
  ENDIF
  AFTER(33)                 // ignore Train 2's S1 departure beam break
  IFNOT(2013)
    AT(2015)                // middle train has consumed/cleared S2 departure
    RESET(2015)
  ENDIF
  AT(26)                    // S2 arrival
  FWD(20)
  DELAY(8000)
  STOP
  DELAYRANDOM(3000, 8000)
  FOLLOW(102)               // never park here (top is at east, not home)

SEQUENCE(150)               // === top parking: lights off, finalize barrier, end ===
  SETLOCO(2)
  STOP
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
  DELAY(1000)
  THROW(2)                  // route-lock: make sure T2 is fully on the T4 path
  DELAY(3000)               // tune only after turnout motion is visibly reliable
  IFNOT(2012)               // skip barrier if top has parked
    SET(2011)               // stage; wait for Train 2 to clear S2
    AT(2010)
    RESET(2011)
    AT(-2010)
  ENDIF
  FWD(40)
  AFTER(33)                 // ignore Train 4's S1 departure beam break
  SET(2014)                 // tell Train 2 S1 is clear now
  AT(26)                    // S2 arrival
  FWD(20)
  DELAY(8000)
  STOP
  DELAYRANDOM(3000, 8000)
  FOLLOW(202)               // never park here (mid is at east, not home)

SEQUENCE(202)               // === T4 west leg (Train 2 going east) ===
  SETLOCO(4)
  IFNOT(2012)
    SET(2011)               // stage; wait for Train 2 to clear S1
    AT(2010)
    RESET(2011)
    AT(-2010)
  ENDIF
  REV(40)
  AFTER(26)                 // ignore Train 4's S2 departure beam break
  SET(2015)                 // tell Train 2 S2 is clear now
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
  DELAY(1000)
  CLOSE(2)                  // route-lock: reassert CLOSED before Train 5 moves
  DELAY(4000)               // keep before SET(2011), so Train 2 remains stopped
  FON(0)
  IFNOT(2012)
    SET(2011)               // stage; wait for Train 2 to clear S2
    AT(2010)
    RESET(2011)
    AT(-2010)
  ENDIF
  FWD(40)
  AFTER(33)                 // ignore Train 5's S1 departure beam break
  SET(2014)                 // tell Train 2 S1 is clear now
  AT(26)                    // S2 arrival
  FWD(20)
  DELAY(10000)              // longer creep -- spur exit transition
  STOP
  DELAYRANDOM(3000, 8000)
  FOLLOW(204)               // never park here (T5 is at east, not home)

SEQUENCE(204)               // === T5 west leg: returns to spur via still-CLOSED T2_t ===
  SETLOCO(5)
  CLOSE(2)                  // route-lock: T5 return also needs the spur path
  DELAY(1000)
  CLOSE(2)
  DELAY(4000)               // tune only if T2 proves consistently faster
  IFNOT(2012)
    SET(2011)               // stage; wait for Train 2 to clear S1
    AT(2010)
    RESET(2011)
    AT(-2010)
  ENDIF
  REV(40)
  AFTER(26)                 // ignore Train 5's S2 departure beam break
  SET(2015)                 // tell Train 2 S2 is clear now
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
  STOP
  FOFF(0)                   // T4 lights off (was on continuously since SEQ 220)
  SETLOCO(5)
  STOP
  FOFF(0)                   // T5 lights off (already off if parking from 204)
  THROW(1)                  // restore startup turnout state
  THROW(2)
  THROW(3)
  SET(2013)                 // tell top: mid is parked, skip future barriers
  SET(2011)                 // unblock any partner currently in AT(2011)
  DELAY(500)
  RESET(2011)
  // task ends; restart by sending </START 100> again
DONE
