# Tribe mascot spec (AllFantasy Survivor leagues)

Each Survivor tribe gets a sports-crest emblem. `compose.py` builds the crest: frame, sport ornament, mascot, name banner.
You draw **only the mascot** in `mascots/<id>.svg`. The reference is `mascots/crab.svg`; read it first and match or beat its level of detail.

## File format
- Root: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">`. Keep the mascot inside roughly x 8–232, y 4–236, centred, filling the box with a strong silhouette.
- Layers are `<g id="...">…</g><!-- /id -->`. The exact closing comment is required because the composer parses it. Required layers:
  - `back-football`, `back-basketball`, `back-baseball`, `back-hockey`, `back-soccer`: drawn **behind** the body. Leave one empty if unused, but it must still exist: `<g id="back-soccer"></g><!-- /back-soccer -->`.
  - `body`: the creature with no sport gear.
  - `front-football`, `front-basketball`, `front-baseball`, `front-hockey`, `front-soccer`: gear drawn **over** the body.
- The crest shows `back-<kit>` + `body` + `front-<kit>`.
- Plain SVG only: path, circle, ellipse, rect, polygon, g with transforms. Not allowed: no `id`s other than the layer ids, no gradients, filters, `<use>`, `<text>`, `<style>`, masks, clipPaths or external refs.

## Colours: never hardcode, except ink
- **Fills:** use `class="X"`.
- **Strokes:** use `stroke-class="X"`, or literal `stroke="#0b0d14"` for ink outlines.
- **Opacity:** `opacity` is fine for highlights.
- Literal hex is allowed **only** for ink `#0b0d14`, and for small fixed neutrals already used in crab.svg (`#f6a76a`, `#f4dcae`, `#2a2d36`, `#4a4f5c`).

Available classes:

| Class | Meaning |
|---|---|
| `p` / `pd` / `pl` | tribe primary / darker / lighter. This is the creature's main colour. |
| `s` / `sd` / `sl` | tribe secondary / darker / lighter. Use for gear (helmet stripe, cap, headband, armband) and creature markings. |
| `l` / `ld` | bone white / bone shade: teeth, eye whites, claws, highlights |
| `k` | ink |
| `e` | glowing yellow eye (optional, for menacing eyes) |
| `r` / `rd` | red (tongue, stitches) / dark mouth interior |
| `br` / `brd` | football leather |
| `or` / `ord` | basketball orange |
| `mt` / `mtd` | metal (facemask, cage) |
| `wd` / `wdd` | wood (bat, stick) |

Tribe colours change per tribe, so the creature must read through **shape and value**, not hue. Example: an orca is primary-dark with `l` patches.

## Style: pro sports-logo quality, not clip-art, not childish
- Bold ink outlines, 4–5px on silhouettes and 2–3px on inner detail. Use the two-layer trick (ink stroke underneath, coloured stroke on top) for limbs and tentacles.
- At least three tones on the creature (p / pd / pl), plus secondary markings, crisp highlight strokes and shadow shapes. Add texture details: scales, feathers, fur clumps, plates, spots, teeth.
- Confident, aggressive, competitive expression: angled brows, bared teeth or a fierce beak, focused eyes. Not cute, not goofy, not scary-gory.
- Head-and-shoulders or full body, whichever gives the strongest silhouette. It must still read as the animal at **48px**.
- No letters or words. The one exception is a small "C" on a soccer captain armband. No real team logos or marks.

## Sport kits: the creature must WEAR gear and HOLD/USE the ball (fit the gear to the anatomy)

| Kit | Wear | Hold |
|---|---|---|
| football | helmet: a full helmet shell on the head with ear hole and facemask, or facemask + helmet stripe as on the crab. Eye black. | a football (`br`, white laces), gripped (draw a finger, claw, wing or tail over it) or tucked |
| basketball | headband or sweatband, wristband, or jersey collar/straps | a basketball (`or`, ink seams): palmed, spun or dribbled |
| baseball | a real baseball cap (crown panels, button, brim) sitting on the head | a bat (`wd`) gripped, or a ball and glove |
| hockey | hockey helmet with cage or visor, or a cage over the mouth | a stick (`wd` with ink tape) and a puck |
| soccer | captain armband (`s`, small "C") or jersey collar or scarf | a soccer ball (`l` with ink pentagons) at the foot, held or headed |

Gear must sit **on** the anatomy: helmets wrap the skull, caps follow the head's angle, and items are actually held. Nothing floats.

## Workflow (must do)
1. Read `mascots/crab.svg` and `SPEC.md`. Look at `review/crab.png` (contact sheet) and `review/crab-big.png`.
2. Write `mascots/<id>.svg`.
3. Build and render: `cd <tribes dir> && python3 compose.py <id> && python3 render.py --mascot <id> review/<id>.png`, then **Read the PNG** and critique it honestly.
4. Fix proportion, anatomy, gear fit, readability and missing detail. **Iterate at least twice** per mascot. Check the small marks too.
5. Do not edit compose.py, render.py, tribes.json, SPEC.md or anyone else's mascot. If the composer has a bug, report it.
