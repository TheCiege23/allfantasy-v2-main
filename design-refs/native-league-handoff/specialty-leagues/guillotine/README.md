# Guillotine: Codex handoff

Source of rules: spec in repo: `docs/PROMPT331_GUILLOTINE_LEAGUE_SPEC.md`

The screens in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups: read them for layout, copy and timing, but don't ship them. The SVGs in `assets/` are production art. `../shared/sp.css` holds the shared styles, and `../tools/gen_*.py` regenerates every asset.

- **Art:** `emblem.svg` is the format crest. Use it on league cards, the league switcher and create-a-league. `banner.svg` (1600×500) is the hero background. It is set to slice, so crop it with `object-fit: cover`. The `icon-*.svg` files are 64px status icons.
- **Accessibility:** every animation has a `prefers-reduced-motion` fallback that shows the end state straight away. Colour is never the only signal; there is always a text tag as well.

## Screens
- **`GuillotineHome`:**
  - **Hero:** a "chop locks in" countdown, timed to the end of the stat-correction window.
  - **The chop line:** every alive team sorted by score, with a dashed **cut line** above the lowest team. Each team is tagged:
    - **Safe**
    - **Danger** (within 12 points of the cut; the threshold is configurable)
    - **Chop zone**

    The panel has a Live / Projected toggle. Chopped teams appear as struck-through chips, with their week and score.
  - **Right rail:**
    - survival odds for this week and each week after, from AF projections
    - the tiebreaker order from the spec: season points, then last period's points, then week-1 draft slot, then commissioner
    - the event feed
- **`GuillotineChop` (signature moment):**
  - Shows the bottom three after elimination lock.
  - "Drop the blade" drops a steel blade over the lowest team (0.5s), draws a red slash and pops a **Chopped** stamp.
  - The released roster then slides in on the right with Bid buttons, which are disabled until the FAAB window opens.
- **`MobileGuillotine`:** how far above the cut you are, the chop zone and danger tier, and calls to action.

## Terms
Use the spec's AllFantasy-native words: **Chop**, **Chop Zone**, **Danger Tier**, **Safe**. Don't use other platforms' names.
