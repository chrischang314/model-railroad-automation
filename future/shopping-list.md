# Shopping List

Hardware to acquire for the ideas in [`ideas.md`](ideas.md). Prices are
indicative; check current vendor pricing before ordering.

## Already on hand

| Item | Source | Status |
| --- | --- | --- |
| EX-CSB1 command station | dcc-ex.com distributors | Installed |
| Kato Unitrack (current loop) | Hobby shop / Amazon | Installed |
| 2 Kato turnouts + Proto Design Labs decoders | proto-design-labs.com | Installed |
| 2 Kato locomotives (Shinkansen, E233) + EM13 decoders | Hobby shop | Installed |
| FR11 function decoders (passenger lighting) | Hobby shop | Installed |
| Azatrax RIR4 IR sensor shield | azatrax.com | Installed |
| 4 Azatrax IR sensor pairs | azatrax.com | 2 mounted, 2 wired-only |
| Arduino Uno R3 | arduino.cc / Amazon | Installed |
| Adafruit BSS138 4-channel level shifter | adafruit.com #757 | Installed |
| Jumper wires (M-F, F-F kit) | Amazon | Installed |

## Short-term (for the existing four sensors)

| Item | Why | Source | Approx cost |
| --- | --- | --- | --- |
| Track adhesive / mounting tape for IR pairs 3 and 4 | Mount the unmounted IR pairs cleanly | Hardware store | $5 |
| Spare jumper wires (any color, M-F) | Replacements when the breadboard gets reorganized | Amazon | $5 |

## Medium-term (next round of features)

| Item | Why | Source | Approx cost |
| --- | --- | --- | --- |
| MCP23017 breakout (Qwiic-compatible) | 16 more sensor pins via I2C, frees up CSB1 GPIO when MotorShield is added later | Adafruit / Sparkfun | $7 |
| Qwiic cable | Plug MCP23017 into the CSB1 without manual jumpering | Sparkfun | $2 |
| LED signal heads (red/yellow/green, 3 mm) | Trackside signaling | Hobby shop / Amazon | $10 for several |
| Resistors (~1 kohm, 1/4 W) | Current-limit for those LEDs at 3.3 V | Electronics supplier | $2 |
| Heat shrink tubing (assorted) | Tidy up sensor pair wiring | Hardware store | $5 |

## Optional / experimental

| Item | Why | Source | Approx cost |
| --- | --- | --- | --- |
| Second Azatrax RIR4 | Doubles sensor capacity to 8 pairs (DIP switches set unique I2C addr) | azatrax.com | $35 |
| PCA9685 16-channel PWM driver | Servo control for turntables, signals, future servo-throw turnouts | Adafruit | $15 |
| Hobby servos (SG90 or MG90S, qty 4..8) | Servo-throw conversion of Kato turnouts | Amazon | $10..$20 |
| Auto-reverser module (NCE AR-10 or DCC Specialties OG-AR) | Reverse loop support | NCE / DCC Specialties | $40 |
| EX-MotorShield8874 | Second power district / programming track booster | dcc-ex.com distributors | $25 |
| Sound-equipped Kato loco (e.g. with built-in sound or ESU LokSound) | Adds horn/bell automation possibilities | Specialty hobby shop | $150+ |

## Tools (one-time)

| Item | Why | Source | Approx cost |
| --- | --- | --- | --- |
| Decent soldering iron (~30..40 W, fine tip) | Good joints on header pins, repair work | Amazon / hardware store | $30 |
| Solder (60/40 rosin core, 0.6..0.8 mm) | For the soldering iron | Same | $10 |
| Solder sponge or brass-wire tip cleaner | Keeps the iron tip clean | Same | $5 |
| Multimeter with continuity beep | Wiring debug, voltage spot-checks | Amazon | $20..$40 |
| Small flathead precision screwdriver (~2 mm) | RIR4 terminal screws, decoder access | Hardware store | $5 |
| Helping-hands tool with magnifier | Holds boards while soldering | Amazon | $15 |

## Notes on sourcing

- **Adafruit and Sparkfun** are reliable for documented breakouts (BSS138,
  MCP23017, PCA9685). Their tutorials and product pages are excellent
  references when wiring something for the first time.
- **Amazon clones** (Elegoo, Keyestudio) are fine for Arduino Uno boards
  and jumper kits but quality varies for higher-precision items like
  level shifters; prefer Adafruit/Sparkfun for those.
- **Hobby shops** still beat online for trial-fitting Kato decoders and
  for getting expert advice on specific Japanese-prototype models.
- **DCC-EX Discord** is the right place to ask "is this part compatible"
  questions; the community knows which clones are problematic.

## Budget tier reminders

- Total spent so far on **bridge electronics** (Arduino + RIR4 + level
  shifter + jumpers): ~$60.
- Estimated medium-term expansion cost (MCP23017 + signals + accessories):
  ~$50.
- A turntable, servo conversion, and sound loco would push this into the
  $400+ tier.
