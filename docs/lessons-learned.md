# Lessons Learned

Read this before changing `dcc-ex/myAutomation.h`. The current candidate script
is v3.18.0 and is pending physical confirmation of the Train 2 direction
pre-arm change.

## Current Rules That Matter

- Start the full shuttle with only `</START 100>`. `</START 200>` is diagnostic
  and should not be part of normal startup.
- S1 and S2 are beam-break sensors across both the top and middle tracks. They
  cannot identify which train or which track caused the trigger.
- Use `AT(33)` for S1 and `AT(26)` for S2. `AT()` takes a vpin, not a sensor
  ID, so do not use `AT(1001)` or `AT(1002)`.
- Every movement leg must consume its own departure beam before listening for
  the opposite arrival beam:
  - Eastbound: `AFTER(33)` then `AT(26)`
  - Westbound: `AFTER(26)` then `AT(33)`
- Do not add partner-departure `AFTER(...)` calls. They can consume the train's
  real arrival event and cause an overrun.
- Do not add random or fixed departure offsets while S1/S2 span both tracks.
  Simultaneous departures are the stable behavior. Random dwell at station
  stops is okay.
- Software flags must live in the declared bitmap range:
  `HAL(Bitmap, 2000, 20)`.
- Turnout polarities are inverted from the first guesses:
  - T1 and T3 start thrown.
  - T2 thrown routes Train 4.
  - T2 closed routes Train 5.
- T2 must be route-locked before Train 5 moves. Reassert `CLOSE(2)` and let
  the turnout settle before the middle task raises `2011`; placing the delay
  after `2011` can let Train 2 start moving while Train 5 is still waiting.
- Current stable speeds are cruise 40 and creep 20. Train 2 and Train 4 creep
  for 8 seconds; Train 5 creeps for 10 seconds.
- `STOP` leaves the previous direction latched. After each station stop, use
  `FWD(0)` or `REV(0)` to pre-arm the next leg while the train remains parked.

## What Worked

- One normal start route: `ROUTE(100)` starts the middle route with
  `START(200)` and then becomes Train 2's task with `FOLLOW(101)`.
- A route wrapper for the middle task: `ROUTE(200)` immediately follows
  `SEQUENCE(220)`. Starting the route wrapper worked where direct sequence
  starts did not.
- Two cooperating tasks, not a chain of `SENDLOCO` calls.
- `HAL(Bitmap,...)` for virtual flags shared by `SET`, `RESET`, `IF`, `IFNOT`,
  and `AT`.
- `AFTER(...)` as a departure-clear primitive. It waits for a sensor to trigger
  and then go off for about 0.5 seconds, which is exactly what a beam-break
  departure needs.
- Shared-sensor handshakes:
  - `2014` means the middle train has consumed and cleared S1 departure.
  - `2015` means the middle train has consumed and cleared S2 departure.
- Zero-speed direction pre-arm:
  - Use `FWD(0)` after a westbound stop when the next leg is eastbound.
  - Use `REV(0)` after an eastbound stop when the next leg is westbound.
- Graceful stop checks only at home arrivals. Stopping mid-leg leaves trains in
  hard-to-recover positions.
- Parking flags plus a short barrier-finalize pulse. This prevents one task
  from waiting forever after its partner has parked.
- Turnout-settle waits belong before paired departure barriers. That creates
  a boring stationary pause instead of disturbing the shared-beam timing.

## What Did Not Work

- `SENDLOCO` as the parallel dispatch mechanism. It caused stalls.
- Multiple `AUTOSTART` blocks for multiple workers. On this firmware, that did
  not create independent tasks.
- Calling `START(...)` twice from one route to create both tasks. The second
  worker did not reliably start.
- Starting `SEQUENCE(220)` directly. Starting `ROUTE(200)` was reliable.
- Blind delays before arming arrival sensors. They either hid the wrong event
  or let trains run past the station.
- Staggering train departures. Shared beam events merged into one continuous
  break when the timing was unlucky.
- Treating a shared beam as if it belonged to only one track.
- EXRAIL `SENSOR(...)` declarations in `myAutomation.h`. Use runtime `<S>`
  commands for physical sensors on this setup.
- Undeclared software flags. The v1.1 stop-flag attempt failed because the
  flag was not backed by a bitmap HAL declaration.

## Corrected AI/Claude Misconceptions

- "More delay makes shared sensors safer." Usually false here. Delay can make
  one train cross a shared sensor while the other train is using it, collapsing
  two detections into one.
- "If a train stops early, it must have reached its own station sensor." False.
  With shared beams, it may have seen another train's departure.
- "If a train overruns, wait for the partner's departure with `AFTER(...)`."
  False. If that departure already cleared, `AFTER(...)` may consume this
  train's real arrival.
- "`AT(sensor_id)` waits for a DCC-EX sensor." False. `AT()` waits on vpin.
- "Negative vpins are the polarity fix." Not universally. This layout works
  with positive `AT(33)` and `AT(26)`.
- "Train 4 and Train 5 have the same route through T2." False. T2 thrown is
  Train 4; T2 closed is Train 5.

## Troubleshooting Shortcuts

- Train 2 starts, reaches east, then everything stalls: the middle task likely
  did not set `2011`. Check `START(200)` and `ROUTE(200)`.
- Both trains leave and immediately slow in the middle: a departure beam is
  being treated as arrival. Check the own-departure `AFTER(...)`.
- Train 2 stops early while Train 5 leaves: check the `2014` or `2015`
  handshake, depending on whether the false event happened at S1 or S2.
- Train overruns a station: look for an `AFTER(...)` that could consume the
  arrival before `AT(...)` arms.
- Train 2 stops at west/home, then starts west again instead of reversing east:
  check that `FWD(0)` is issued after the westbound stop before `FOLLOW(103)`.
- Graceful stop hangs: check parked flags `2012` / `2013` and barrier pulses
  `2010` / `2011`.
