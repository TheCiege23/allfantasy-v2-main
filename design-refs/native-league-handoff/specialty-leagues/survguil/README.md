# Survivor Guillotine: Codex handoff

Source of rules: **PROPOSED RULES. There is no spec in the repo yet.** Confirm these before building.

The screens in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups: read them for layout, copy and timing, but don't ship them. The SVGs in `assets/` are production art. `../shared/sp.css` holds the shared styles, and `../tools/gen_*.py` regenerates every asset.

- **Art:** `emblem.svg` is the format crest. Use it on league cards, the league switcher and create-a-league. `banner.svg` (1600×500) is the hero background. It is set to slice, so crop it with `object-fit: cover`. The `icon-*.svg` files are 64px status icons.
- **Accessibility:** every animation has a `prefers-reduced-motion` fallback that shows the end state straight away. Colour is never the only signal; there is always a text tag as well.

## Proposed rules (shown on screen with a dashed "Proposed rules" tag)
1. Tribes race on total points each week.
2. The losing tribe's lowest score is chopped automatically. There is no vote.
3. An idol played before lineup lock blocks the blade, and the next lowest score in that tribe is chopped instead.
4. At 6 managers left the tribes merge. From then on, the lowest score overall is chopped each week.
5. The last one standing wins.

It reuses the Survivor tribes, crests, idols and Exile assets from `../../survivor-theme/`, `../../tribes/` and `../../exile/`.

## Screens
- **`SurvivorGuillotineHome`:** the tribe race, the chop line inside the losing tribe, an "idols are hidden" card and the rules.
- **`SurvivorGuillotineChop` (signature moment):**
  1. The blade falls on the lowest score.
  2. The idol pops up and knocks the blade back.
  3. The blade slides to the next lowest.
  4. The blade falls and the **Chopped** stamp appears.
- **`MobileSurvivorGuillotine`:** how far you are above the blade, and your tribe sorted from lowest score.
