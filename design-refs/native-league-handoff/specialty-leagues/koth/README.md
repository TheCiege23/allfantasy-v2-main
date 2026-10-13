# King of the Hill: Codex handoff

Source of rules: **PROPOSED RULES. There is no spec in the repo yet.** Confirm these before building.

The screens in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups: read them for layout, copy and timing, but don't ship them. The SVGs in `assets/` are production art. `../shared/sp.css` holds the shared styles, and `../tools/gen_*.py` regenerates every asset.

- **Art:** `emblem.svg` is the format crest. Use it on league cards, the league switcher and create-a-league. `banner.svg` (1600×500) is the hero background. It is set to slice, so crop it with `object-fit: cover`. The `icon-*.svg` files are 64px status icons.
- **Accessibility:** every animation has a `prefers-reduced-motion` fallback that shows the end state straight away. Colour is never the only signal; there is always a text tag as well.

## Proposed rules (shown on screen with a dashed "Proposed rules" tag)
1. Week 1's top scorer takes the crown.
2. Each week, last week's top scorer (not the King) challenges the King head to head.
3. Outscore the King and the crown moves to you. Ties go to the King.
4. Everyone else plays a normal schedule for the standings.
5. The most weeks wearing the crown wins the season. Ties are broken by successful defenses, then total points.

## Screens
- **`KingOfTheHillHome`:**
  - the live challenge card: King against challenger, with AF odds
  - reign history week by week
  - the crown race table
- **`KingOfTheHillDuel` (signature moment):** "Final whistle" makes the crown arc across from the King to the challenger (1s), then the headline "TheCiege26 takes the Hill".
- **`MobileKingOfTheHill`:** the challenge and the crown race.
