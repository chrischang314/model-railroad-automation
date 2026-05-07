# Layout Diagram

Track topology, sensor placements, and turnout positions for the current
shuttle layout.

## Track plan (logical view)

```
                           STATION
        +-----------------------------------------+
        |   Track A  (Train 2 / Shinkansen)      |
        +--------------------+---------------------+
                             |
                       [ Turnout 2 ]
                             |
        +--------------------+---------------------+
        |   Track B  (Train 4 / E233)            |
        +--------------------+---------------------+
                             |
                             v
                   [ Sensor 1001 -- vpin 33 ]   <- "near end"
                             |
                             |
                             |   long shared track
                             |   (most of the running distance)
                             |
                             |
                   [ Sensor 1002 -- vpin 26 ]   <- "far end"
                             |
                             v
                       (track ends here)
```

The shared long track has no return loop. Trains run out and reverse home.

## Sensor map

| Sensor ID (DCC-EX) | RIR4 detector # | CSB1 vpin | Position | EXRAIL polarity |
| --- | --- | --- | --- | --- |
| 1001 | 1 | 33 | Near end of long track (close to station) | `AT(33)` (positive vpin = active high) |
| 1002 | 2 | 26 | Far end of long track | `AT(26)` |
| 1003 (reserved) | 3 | 16 | Not yet installed | reserved |
| 1004 (reserved) | 4 | 17 | Not yet installed | reserved |

The Arduino sketch was tuned so the GPIO output is **LOW when the detector
is occupied**. Combined with how DCC-EX `AT()` and JMRI sensor polarity
interact, the working incantation is `AT(positive_vpin)` (no minus sign).
The chain has multiple inversions so trust empirical verification over
derived logic. See [`lessons-learned.md`](lessons-learned.md) for the saga.

## Turnout map

| Turnout ID (DCC-EX) | DCC accessory address | Position | State semantics |
| --- | --- | --- | --- |
| 1 | 1 | (currently unused) | Reserved for future expansion |
| 2 | 2 | Station throat | **Thrown** = Train 2's route; **Closed** = Train 4's route |

## Train roster (where they live)

| DCC address | Display name | Type | Decoders | Parking position |
| --- | --- | --- | --- | --- |
| 2 | KATO Shinkansen | Train A (runs first) | EM13 motor + FR11 lights (cars at addr 2) | Track A at station |
| 4 | KATO E233 | Train B (runs second) | EM13 motor + FR11 lights (cars at addr 4) | Track B at station |

## Behavioural cycle

```
       +------------------------------+
       |  Trigger: </START 100>       |
       +-------------+----------------+
                     v
       +------------------------------+
       |  Throw turnout 2             |
       |  Train 2: FWD(80)            |
       +-------------+----------------+
                     v
       +------------------------------+
       |  AT(26) -- arrive at far end |
       |  Train 2: FWD(40), 3s creep  |
       |  STOP, dwell 10s             |
       +-------------+----------------+
                     v
       +------------------------------+
       |  Train 2: REV(80)            |
       |  AT(33) -- back near station |
       |  Train 2: REV(40), 3s creep  |
       |  STOP, dwell 10s             |
       +-------------+----------------+
                     v
       +------------------------------+
       |  Close turnout 2             |
       |  Train 4: FWD(80)            |
       |  ... mirror of Train 2 cycle |
       |  ... ends with SENDLOCO(2,10)|
       +-------------+----------------+
                     v
            (loops indefinitely)
```

## Power feed

CSB1's `MAIN` track output -> Kato Terminal Unijoiner -> injected once into
the layout. DCC is a symmetric protocol so feed polarity is not critical, but
must be consistent across feeders. Per Kato manufacturer guidance one feeder
suffices for layouts under ~8 feet of total track; add a feeder every 6..8 ft
for larger layouts.

For Kato #4 turnouts, set the underside switch to **non-power-routing** so the
diverging route stays energized for DCC.

## Physical positioning notes

- Sensor 1001 should sit just inside the long track from the station (within
  ~6 in of the turnout exit). Trains reach it at full cruise speed and use it
  as the slowdown trigger on the way back.
- Sensor 1002 should sit a fixed distance from the end of the long track --
  far enough that a `FWD(40)` for 3 s plus the natural deceleration brings the
  train to rest before the buffer.
- The detector "fingers" of the Azatrax pairs face each other across the
  rails. Aim the IR LED and phototransistor at each other through the train
  silhouette zone.

## Future layout work

- Mount IR pairs for sensors 1003 and 1004 (vpins 16 and 17). The Arduino
  sketch already polls all four detectors; the level shifter is wired through
  to the CSB1; only the physical sensor pairs and uncommenting two lines in
  `dcc-ex/sensor-setup-commands.txt` are needed to bring them online.
- Possible mid-track passing siding (would need a new turnout, accessory
  decoder, and at least one new sensor for occupancy).
- Possible reverse loop (would require an auto-reverser module and additional
  block detection).
