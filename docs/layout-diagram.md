# Layout Diagram

Current layout for the v3.18.0 direction pre-arm EXRAIL automation.
The last physically confirmed stable baseline is v3.16.0-STABLE.

## Logical Track Plan

```text
                         East / far end

Top track:    -------- Train 2 shuttle ----------------
                       ^ S1                       ^ S2
                       | vpin 33                  | vpin 26
                       | shared beam              | shared beam
                       v                           v
Middle track: --T2-----+------------ T1 ----------+---T3----
Spur:             \--- Train 5 home

                         West / station end
```

S1 and S2 are beam-break sensors across both the top and middle tracks. They do
not tell the script which track or which train crossed the beam.

## Sensor Map

| Label | Sensor ID | CSB1 vpin | Physical position | EXRAIL usage |
| --- | --- | --- | --- | --- |
| S1 | 1001 | 33 | West/home-side shared beam | `AT(33)` / `AFTER(33)` |
| S2 | 1002 | 26 | East/far-side shared beam | `AT(26)` / `AFTER(26)` |
| Reserved | 1003 | 16 | Not mounted | Future use |
| Reserved | 1004 | 17 | Not mounted | Future use |

The Arduino/RIR4/level-shifter chain was empirically verified with positive
vpins in EXRAIL. Do not change to `AT(-33)` or `AT(-26)` unless a physical
polarity test proves it is necessary.

## Turnout Map

| Label | Address | Startup state | Stable meaning |
| --- | --- | --- | --- |
| T1 | 1 | Thrown | Double-turnout / double-slip kept open for the parallel tracks |
| T2 | 2 | Thrown | Thrown for Train 4, closed for Train 5 |
| T3 | 3 | Thrown | Kept open for the current route |

All turnout polarities are treated as inverted from the first assumptions:
`THROW(1)`, `THROW(2)`, and `THROW(3)` are the startup-safe states.

## Train Positions

| Address | Role | Starting/home position |
| --- | --- | --- |
| 2 | Top-track shuttle | West side of top track |
| 4 | Middle main shuttle | West side of middle track |
| 5 | Spur shuttle alternating with Train 4 | BL spur off T2 |

Unused addresses in the current automation: 1, 6, 7.

## Stable Cycle

```text
START 100
  |
  +-- Middle task spawns and stages
  |
  +-- Train 2 makes first solo west-to-east trip
  |
  +-- Repeating paired crossings:
        Train 2 shuttles top track continuously
        Train 4 goes east and west
        Train 5 goes east and west
        Train 4 and Train 5 alternate
```

Train 2 and the active middle train depart together during paired crossings.
This is intentional. With shared beams, intentional departure delays caused
merged sensor events and missed arrivals.

## Motion Tuning

| Train | Cruise | Creep | Creep time | Random dwell |
| --- | --- | --- | --- | --- |
| Train 2 | 40 | 20 | 8 seconds | 3 to 8 seconds |
| Train 4 | 40 | 20 | 8 seconds | 3 to 8 seconds |
| Train 5 | 40 | 20 | 10 seconds | 3 to 8 seconds |

## Power Feed

CSB1 `MAIN` output feeds the Kato Unitrack layout through a Kato Terminal
Unijoiner. DCC polarity is symmetric, but keep feeder polarity consistent if
additional feeders are added.

For Kato #4 turnouts, use the non-power-routing setting for DCC reliability.
