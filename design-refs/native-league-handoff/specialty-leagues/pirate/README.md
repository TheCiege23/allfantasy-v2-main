# Pirate: Codex handoff

Source of rules: **PROPOSED RULES. There is no spec in the repo yet.** Confirm these before building.

The screens in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups: read them for layout, copy and timing, but don't ship them. The SVGs in `assets/` are production art. `../shared/sp.css` holds the shared styles, and `../tools/gen_*.py` regenerates every asset.

- **Art:** `emblem.svg` is the format crest. Use it on league cards, the league switcher and create-a-league. `banner.svg` (1600×500) is the hero background. It is set to slice, so crop it with `object-fit: cover`. The `icon-*.svg` files are 64px status icons.
- **Accessibility:** every animation has a `prefers-reduced-motion` fallback that shows the end state straight away. Colour is never the only signal; there is always a text tag as well.

## Proposed rules (shown on screen with a dashed "Proposed rules" tag)
1. Win your matchup and plunder one unanchored player from the loser's roster (their "hold").
2. The winner also takes 5 doubloons (FAAB) from the loser.
3. Each crew anchors 3 players, who can't be taken. Anchors can change once a week, before Thursday kickoff.
4. The week's top score earns a 5-doubloon bounty.
5. Last place at the trade deadline walks the plank and loses an anchor.
6. If the winner doesn't pick within the window, AF takes the highest-value unanchored player for them.

## Screens
- **`PirateHome`:**
  - this week's raid card
  - **the fleet:** standings shown as ships, with records and doubloons
  - your hold, with anchored tags
  - the code (the rules) and the ship's log
- **`PiratePlunder` (signature moment):** pick a player from the loser's hold (anchored players are locked), then "Take X aboard" confirms with a doubloon transfer.
- **`MobilePirate`:** the raid, their best unanchored players and the bounty.
