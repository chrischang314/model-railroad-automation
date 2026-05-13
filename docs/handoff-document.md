# Model Railroad Automation Handoff

This is the current technical handoff for the working DCC-EX / EXRAIL
automation. It supersedes older two-train notes from the initial project import.

Last updated: 2026-05-13
Stable script: `dcc-ex/myAutomation.h`, v3.16.0-STABLE
Normal start command: `</START 100>`
Graceful stop command: `</START 110>`

## 1. Current Stable Behavior

The layout now runs three active train addresses:

| Train | Address | Track role | Home position |
| --- | --- | --- | --- |
| Train 2 | 2 | Top track shuttle | West/top station track |
| Train 4 | 4 | Middle main shuttle, alternates with Train 5 | West/middle station track |
| Train 5 | 5 | Spur shuttle, alternates with Train 4 | BL spur off T2 |

Trains 1, 6, and 7 exist in the roster universe but are unused by this script.

Stable cycle:

1. Train 2 makes one solo west-to-east top-track trip so the middle task can
   spawn and stage.
2. Train 2 continues shuttling on the top track.
3. Train 4 and Train 5 alternate on the middle/spur route.
4. During normal cycles, Train 2 and the active middle train depart together
   and pass each other in opposite directions.
5. S1 and S2 are shared beam-break sensors across both the top and middle
   tracks, so the script uses software handshakes to avoid treating one train's
   departure as the other train's arrival.
6. `</START 110>` requests a graceful stop. Each task finishes a home-return
   leg, turns headlights off, restores turnouts, and ends.

Working speeds and dwell tuning:

| Motion | Setting |
| --- | --- |
| Cruise speed | `FWD(40)` / `REV(40)` |
| Slow creep speed | `FWD(20)` / `REV(20)` |
| Train 2 creep time | 8 seconds |
| Train 4 creep time | 8 seconds |
| Train 5 creep time | 10 seconds |
| Random stop dwell | `DELAYRANDOM(3000, 8000)` |

## 2. Layout Facts

Logical layout:

```text
Top track:    -------- Train 2 shuttles here --------
                       ^ S1                    ^ S2
                       | vpin 33               | vpin 26
                       | beam crosses both     | beam crosses both
                       v                        v
Middle track: --T2-----+--------- T1 ----------+---T3-----
Spur:             \--- Train 5 home
```

Sensor map:

| Label | DCC-EX sensor ID | CSB1 vpin | Physical meaning |
| --- | --- | --- | --- |
| S1 | 1001 | 33 | West/home-side beam, spans both tracks |
| S2 | 1002 | 26 | East/far-side beam, spans both tracks |

Turnout policy:

| Turnout | Address | Stable startup state | Meaning in this layout |
| --- | --- | --- | --- |
| T1 | 1 | `THROW(1)` | Double-turnout / double-slip, keep thrown |
| T2 | 2 | `THROW(2)` | Thrown for Train 4, closed for Train 5 |
| T3 | 3 | `THROW(3)` | Keep thrown |

Important correction: the turnout decoder polarities are inverted from what an
LLM may guess. In this layout, thrown means the main/straight path for T1/T3
and the Train 4 middle route for T2. T2 closed selects Train 5's spur route.

## 3. Commands

Re-send physical sensor declarations after each CSB1 firmware flash:

```text
<S 1001 33 0>
<S 1002 26 0>
```

Start the full stable automation:

```text
</START 100>
```

Do not send `</START 200>` for normal operation. It is diagnostic only.

Stop gracefully:

```text
</START 110>
```

Emergency stop:

```text
</KILL ALL>
<!>
```

Useful diagnostics:

```text
<S>      list configured sensors
<JA>     list loaded EXRAIL routes/sequences
</>      list running EXRAIL tasks
</START 290>  pulse mid_ready, useful only to release a diagnostic stall
```

## 4. EXRAIL Architecture

The stable design uses two cooperating EXRAIL tasks:

| Task | How it starts | Responsibility |
| --- | --- | --- |
| Top task | `ROUTE(100)` falls through via `FOLLOW(101)` | Train 2 on top track |
| Middle task | `ROUTE(100)` calls `START(200)` | Train 4 / Train 5 alternation |

`ROUTE(200)` is intentionally a route wrapper that immediately `FOLLOW`s
`SEQUENCE(220)`. Starting a route proved reliable where starting a sequence
directly did not.

Virtual flags are declared with:

```cpp
HAL(Bitmap, 2000, 20)
```

Active software flags:

| Vpin | Meaning |
| --- | --- |
| 2001 | Graceful stop request |
| 2010 | Top task release / ready barrier |
| 2011 | Middle task ready barrier |
| 2012 | Top task has parked |
| 2013 | Middle task has parked |
| 2014 | Middle train has consumed and cleared S1 departure |
| 2015 | Middle train has consumed and cleared S2 departure |

The bitmap HAL declaration matters. Without it, `SET`/`RESET` and
`IF`/`AT` can behave like they are reading different state tables.

## 5. What Worked

- `</START 100>` as the single user-facing command.
- Spawning only one extra task with `START(200)` and letting the current route
  become the top task with `FOLLOW(101)`.
- Wrapping the spawned middle logic in `ROUTE(200)` instead of trying to start
  `SEQUENCE(220)` directly.
- `HAL(Bitmap, 2000, 20)` for inter-task software flags.
- `AFTER(departure_sensor)` before `AT(arrival_sensor)` on every movement leg.
  This consumes the train's own departure beam break before arming the arrival.
- Simultaneous paired departures. Intentional offsets caused the two physical
  beam breaks to merge into one continuous sensor event.
- S1 and S2 clear handshakes:
  - Middle task sets `2014` after `AFTER(33)`.
  - Middle task sets `2015` after `AFTER(26)`.
  - Train 2 waits for the relevant flag before arming its shared arrival beam.
- Parking flags and barrier-finalize pulses for graceful stop. These prevent
  the surviving task from deadlocking when the other task has already parked.
- Halved speeds: cruise 40 and creep 20 are the stable physical values.
- Train 5 needs a 10 second creep period through the spur transition.

## 6. What Did Not Work

- `SENDLOCO` for parallel task spawning. It was unreliable for this use case.
- Multiple `AUTOSTART` blocks. On the tested firmware, only the first behaved
  like a true boot task; later blocks did not spawn independent workers.
- Two `START(...)` calls inside one route to start both tasks. The second task
  did not reliably start.
- `START(220)` directly on the middle sequence. Starting a route wrapper
  (`START(200)`) was the reliable form.
- Blind fixed delays to mask departure sensors. They either caused overruns or
  deadlocks depending on where a train was sitting.
- Intentional departure staggering. With shared beam sensors, staggered trains
  can overlap at S1 or S2 and collapse two events into one.
- Partner-departure `AFTER(...)` waits. If the partner had already cleared the
  beam, `AFTER()` could consume this train's real arrival and arm `AT()` too
  late.
- Treating S1/S2 as track-specific sensors. They see both top and middle rails.
- `AT(1001)` / `AT(1002)`. `AT()` takes vpins, so use `AT(33)` / `AT(26)`.
- EXRAIL `SENSOR(...)` declarations. They are not available in the tested
  DCC-EX 5.6.0 setup. Use runtime `<S ...>` commands for physical sensors.
- Undeclared virtual flags. Declare software flags with `HAL(Bitmap,...)`.

## 7. Corrected AI/Claude Misconceptions

Do not infer EXRAIL syntax from general C/C++ or from old examples. Several
earlier Claude/LLM guesses were plausible but wrong for this firmware and this
layout. Verify against the actual script and current DCC-EX documentation.

High-risk misconceptions to avoid:

- Misconception: `START(100)` can freely create many parallel tasks.
  Correction: this script uses one `START(200)` plus `FOLLOW(101)` because
  that is what tested reliably.
- Misconception: `SENDLOCO` is the right way to run a second train in parallel.
  Correction: it was removed because it stalled or failed to spawn reliably.
- Misconception: beam-break sensors can identify which track was broken.
  Correction: S1/S2 span both tracks, so all logic must assume ambiguity.
- Misconception: random departure delays make the railroad look better.
  Correction: random stop dwell is fine; random departure offsets are unsafe
  with shared beam sensors.
- Misconception: if a train stops early, add more delay.
  Correction: early stops usually mean a shared beam was armed too soon. Add
  or fix a handshake, not a blind delay.
- Misconception: if a train overruns, add a partner `AFTER(...)`.
  Correction: partner `AFTER(...)` was one of the causes of overruns.
- Misconception: negative vpins are the universal fix for sensor polarity.
  Correction: this layout empirically works with positive `AT(33)` and
  `AT(26)`.

## 8. Troubleshooting Guide

### `</START 100>` starts Train 2, then stalls

Check whether the middle task started. Run `</>` to list tasks if available.
`</START 290>` pulsing `2011` can release Train 2 for diagnosis only. If that
releases the stall, the top task was waiting for a middle-ready barrier.

Likely causes:

- `START(200)` changed back to `START(220)`.
- `ROUTE(200)` was removed or no longer follows `SEQUENCE(220)`.
- The middle task is blocked before setting `2011`.

### Train departs and immediately slows/stops

This usually means it saw its own departure beam as an arrival.

Check:

- Eastbound legs must use `AFTER(33)` before `AT(26)`.
- Westbound legs must use `AFTER(26)` before `AT(33)`.
- The `AFTER(...)` must be for that train's own departure beam, not the
  partner's departure beam.

### Train 2 stops in the middle during a Train 4/5 departure

This is the shared-beam false-arrival failure mode.

Check:

- For Train 2 westbound arrival at S1, it must wait for vpin `2014` before
  arming `AT(33)`.
- For Train 2 eastbound arrival at S2, it must wait for vpin `2015` before
  arming `AT(26)`.
- The middle task must set `2014` immediately after `AFTER(33)` and `2015`
  immediately after `AFTER(26)`.

### Train overruns a station sensor

Likely causes:

- `AT(...)` armed too late because an `AFTER(...)` consumed the real arrival.
- S1/S2 were held continuously by two trains crossing too close together.
- Cruise/creep speeds or decoder momentum are too high.

Do not add blind delays first. Verify the event ordering in the script and the
physical timing at the shared beam.

### Graceful stop hangs

Check the parking logic:

- Top parking sequence must set `2012` and pulse `2010`.
- Middle parking sequence must set `2013` and pulse `2011`.
- Each active barrier must be wrapped in `IFNOT(partner_parked)`.

### Sensors do not react

Work layer by layer:

1. Arduino Serial Monitor shows RIR4 detector changes.
2. Level shifter output changes at CSB1 side.
3. Runtime sensor declarations exist: `<S>`.
4. JMRI Sensor Table changes when a beam is broken.
5. EXRAIL uses vpin numbers: `AT(33)` and `AT(26)`.

## 9. Stable File Map

| File | Purpose |
| --- | --- |
| `dcc-ex/myAutomation.h` | Current stable EXRAIL script |
| `dcc-ex/myAutomation-backup.h` | Synced stable backup copy |
| `dcc-ex/sensor-setup-commands.txt` | Physical sensor declarations to resend after flash |
| `docs/layout-diagram.md` | Current layout and behavior diagram |
| `docs/lessons-learned.md` | Condensed rules and pitfalls |
| `reference/command-cheatsheet.md` | Runtime commands and EXRAIL macro notes |

## 10. Change Discipline

For future changes:

1. Change one timing or handshake at a time.
2. Keep physical sensor ambiguity front and center.
3. Do not reintroduce staggered departures unless the sensor hardware changes.
4. Preserve `HAL(Bitmap, 2000, 20)` if adding flags in the 2000 range.
5. Preserve `START(200)` plus `FOLLOW(101)` unless a new spawn mechanism is
   tested on the actual CSB1.
6. After any firmware flash, resend the two physical `<S>` commands.
7. Commit every user-confirmed stable physical behavior before experimenting.
