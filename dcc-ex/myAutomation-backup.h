// myAutomation-backup.h
//
// Last known-good backup of myAutomation.h.
// Restore by copying this file over myAutomation.h and re-flashing the CSB1
// via EX-Installer. Keep this file in sync with myAutomation.h after every
// confirmed-working change.
//
// This copy mirrors myAutomation.h as of v1.0.0 (initial GitHub import,
// 2026-05-07). The shuttle has been verified end-to-end: two trains,
// infinite loop, sensor-driven slowdown and stop.

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
  SENDLOCO(4, 20)
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
  SENDLOCO(2, 10)
DONE
