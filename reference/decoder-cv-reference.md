# Decoder CV Reference

Configuration variable (CV) settings for the decoders installed on this
layout. CVs are read and written via the **PROG** track using JMRI's
DecoderPro or via raw `<W>` / `<R>` commands. **The MAIN track does not work
for full CV programming -- only Operations Mode (POM) writes work there, and
they cannot be read back.**

## Quick CV refresher

| CV  | Meaning |
| --- | --- |
| 1   | Short address (1..127) |
| 2   | Vstart -- starting voltage. Higher = train moves at lower throttle steps. |
| 3   | Acceleration rate. Higher = takes longer to reach target speed. |
| 4   | Deceleration rate. Higher = takes longer to stop. |
| 5   | Vmax -- top speed at throttle step 28/128. |
| 6   | Vmid -- middle of the speed curve. |
| 17/18 | Long address (CV17 = high byte, CV18 = low byte). |
| 19  | Consist address (for double-heading). |
| 29  | Configuration byte: direction, address length, speed steps, etc. |

Anything beyond CV29 is decoder-specific. Refer to the manufacturer's manual.

## Locos

### KATO Shinkansen (DCC #2, motor decoder: EM13)

| CV  | Value | Notes |
| --- | --- | --- |
| 1   | 2     | Short address. |
| 3   | TBD   | Acceleration rate. Lowering this gives crisper stops in the shuttle automation. Recommended starting point: 5..10. |
| 4   | TBD   | Deceleration rate. Same recommendation. |
| 5   | TBD   | Tune Vmax so cruise speed `FWD(40)` matches the prototype's "feels right" speed. |
| 6   | TBD   | Vmid. Adjust so the speed curve is roughly linear. |
| 29  | 6     | Standard: forward direction normal, 28-step mode, short address. Set bit 5 (=32) to enable long-address mode if migrating to a 4-digit address. |

EM13 is Kato's drop-in motor decoder; replaces the brass strip in the loco's
chassis. Programming requires removing the body shell to expose the EM13's
pads, but the body comes off easily on most Kato N-scale models.

### KATO E233 (DCC #4, motor decoder: EM13)

| CV  | Value | Notes |
| --- | --- | --- |
| 1   | 4     | Short address. |
| 3   | TBD   | See Shinkansen notes. |
| 4   | TBD   | See Shinkansen notes. |
| 5   | TBD   | Tune for visual parity with the Shinkansen at the same throttle setting. |
| 6   | TBD   | Vmid. |
| 29  | 6     | Standard. |

### Lighting (FR11 in passenger cars)

The FR11 is Kato's drop-in function decoder for passenger cars. Address it to
match the loco's address so the throttle controls them together.

| CV  | Value | Notes |
| --- | --- | --- |
| 1   | matches the loco | E.g. `2` for the Shinkansen consist; `4` for the E233 consist. |

By default, the FR11's interior lighting comes on with **F0**, not F1. If F0
does not light the cars after programming, the FR11 may have non-standard
function mapping; check by toggling `F1`, `F2`, etc. and remap via DecoderPro
if needed.

**FR11 programming gotcha: "no decoder detected".** Function-only decoders draw
very little current, often below the threshold the CSB1 uses to detect a
programming-track ACK pulse. The first read attempt on the PROG track may
report "no decoder detected" even though the FR11 is fine. Workarounds:

1. Use a **programming track booster** like the SoundTraxx PowerPax or
   DCC Specialties PTB-100. They reshape the programming pulse so weak
   decoders ACK reliably.
2. Place a **resistor across the rails** of the programming track (~1 kohm,
   1/4 W) to mimic a heavier load.
3. **Blind write**: assume the decoder is OK and write CV1 (address) without
   reading first. Then test by selecting the new address on the main and
   issuing function commands.

### Sound (if/when added: FL12 or sound decoders)

Function decoders without motor drive. Useful in unpowered lead/trail cars to
add headlights, ditch lights, or sound. Same addressing pattern -- match the
loco's DCC address.

## Turnout decoders

### Proto Design Labs decoders (Kato turnouts)

Magnetic programming method (PDL N6R, N6L, and similar):

1. Place the layout in a normal powered state on the **main** track (not the
   programming track) -- magnetic programming is an ops-mode feature.
2. Hold a magnet **directly above** the PDL decoder you want to program.
   (Not below or beside; placement matters because the decoder uses an
   internal reed switch.)
3. In JMRI's Turnout Table, click **Thrown** (or **Closed**) for the new
   target address. The decoder reads the accessory command on the wire
   while the magnet is held and stores the new address.
4. Remove the magnet.
5. Verify: send `<T new_addr 1>` and `<T new_addr 0>` -- the turnout should
   click both directions.

Internally this updates the decoder's CV1 and CV9 (high/low byte of the
address) and persists them.

Currently programmed:

- Turnout 1 -> address 1 (currently unused in the shuttle script)
- Turnout 2 -> address 2 (station turnout)

**Disable magnetic programming once you are happy with the addresses.**
Otherwise stray magnets -- especially from the speakers in sound-equipped
locomotives passing over the turnout -- can accidentally reprogram a
decoder. PDL provides a CV/command to disable magnetic programming
broadcast-wide. Re-enabling later for legitimate reprogramming uses
**Programming on the Main** (ops-mode CV write at the decoder's address).
Check the PDL documentation for the specific CV.

PDL decoders draw very little quiescent current and are well-suited to the
small Kato turnout solenoids.

## Programming track setup

Use **plastic Unijoiners** to electrically isolate a short section of track
(~1 ft) from the rest of the layout. Wire the CSB1 PROG output to that
section. This isolation prevents:

- Other locos on the layout from accidentally responding to programming
  commands (CV writes broadcast on the prog track during a write).
- Reading errors caused by other decoders' current draw masking the
  programming current pulse.

## Common CV-related commands

| Command | What it does |
| --- | --- |
| `<W cv val>` | Write CV `cv` to value `val` on the PROG track (paged mode). |
| `<W cv val cb>` | Write with callback bits (advanced). |
| `<R cv cb cs>` | Read CV `cv` on the PROG track. |
| `<w addr cv val>` | Operations Mode write -- write CV `cv` to value `val` on loco `addr` over the MAIN track. Cannot be read back. |
| `<W addr>` | Write a short address to the decoder on the PROG track. |
| `<W LONG addr>` | Write a long address (programs CVs 17/18/29 atomically). |

## Consisting Kato decoders (EM13 + FR11s in one train)

Each Kato drop-in is an independent DCC device with its own address. There
is no native DCC concept of "this group of decoders is one train." Three
options for getting a Shinkansen or E233 consist to behave as one unit:

### Option 1 (current setup): same address on every decoder

Program the EM13 in the powered car and every FR11 in the passenger cars to
the **same DCC address** (2 for the Shinkansen, 4 for the E233). When you
select the address on a throttle, the motor decoder responds to throttle
moves and every lighting decoder responds to F-key presses simultaneously.

Pros: simplest possible setup; no consist registers to maintain; lights are
"automatic" with the throttle selection.
Cons: cars are permanently bound to one loco. Not useful for fluid consist
composition.

This is the option used on the layout today.

### Option 2: DCC advanced consist (CV19)

Set CV19 on each decoder to a shared "consist address" (e.g. 100). Use
JMRI's **Tools -> Consisting Tool -> Advanced Consist (CV19)** to manage
addition and removal cleanly. CV21 and CV22 control which functions follow
the consist address vs. the decoder's native address.

Pros: real DCC consist support; portable across command stations;
dynamically configurable.
Cons: function mapping across a consist gets fiddly; overkill for a fixed
EM13+FR11 pair in a single chassis.

### Option 3: WiThrottle multi-loco selection

If you use JMRI's WiThrottle server (with EngineDriver, WiThrottle on iOS,
or similar), select multiple Roster entries on a single throttle face.
The throttle sends identical commands to every selected address.

Pros: zero decoder configuration; perfect for ad-hoc consists during an
operating session.
Cons: throttle-side only -- the consist evaporates when the throttle is
disconnected.

## Tuning notes

- **Lower CV3/CV4 (acceleration/deceleration) for automation.** High momentum
  causes long coasts and sloppy sensor stops. 5..10 gives predictable behavior.
- **Set active locos to the same CV5 max.** Otherwise the same `FWD(40)` will
  give noticeably different speeds, and you'll spend forever rebalancing the
  shuttle timing.
- **Don't tune CVs while the layout is running automation.** The script will
  keep dispatching commands to the loco being tuned and produce confusing
  results.
- **Forward/reverse direction depends on physical loco orientation, not CV.**
  If a loco moves the wrong way, physically turn it around or swap CV29 bit 0
  (=1) -- but be aware the change applies to all subsequent throttle commands.

## Cross-reference

- [DCC-EX programming reference](https://dcc-ex.com/reference/software/programming.html)
- [NMRA Standard for Configuration Variables (S-9.2.2)](https://www.nmra.org/sites/default/files/standards/sandrp/pdf/s-9.2.2_decoder_cvs_2012.07.pdf)
- [JMRI DecoderPro user guide](https://www.jmri.org/help/en/html/apps/DecoderPro/index.shtml)
