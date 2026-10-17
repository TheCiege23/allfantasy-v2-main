# Devy: Codex handoff

Source of rules: spec in repo: `docs/DYNASTY_DEVY_TAXI_FINAL_DELIVERY.md`, `lib/devy/*`

The screens in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups: read them for layout, copy and timing, but don't ship them. The SVGs in `assets/` are production art. `../shared/sp.css` holds the shared styles, and `../tools/gen_*.py` regenerates every asset.

- **Art:** `emblem.svg` is the format crest. Use it on league cards, the league switcher and create-a-league. `banner.svg` (1600×500) is the hero background. It is set to slice, so crop it with `object-fit: cover`. The `icon-*.svg` files are 64px status icons.
- **Accessibility:** every animation has a `prefers-reduced-motion` fallback that shows the end state straight away. Colour is never the only signal; there is always a text tag as well.

## Screens
- **`DevyHome`:** a pipeline view.
  - **Pro roster:** slot grid.
  - **Taxi squad.**
  - **Devy stash:** each college player shows their school, class, AF production bar and year (2027, 2028, or Declared).
  - A **Declared** callout, and pipeline value by year.
- **`DevyPromotion` (signature moment):**
  - A card flips (0.9s, 3D) from the college jersey to the pro jersey.
  - You choose the destination, **Pro roster** or **Taxi squad**, and the slot counters update.
- **`MobileDevy`:** Devy / Taxi / Pro tabs and the stash list.

## Matches the lifecycle states
NCAA_DEVY_ACTIVE, then PROMOTION_ELIGIBLE, then PROMOTED_TO_PRO. "Return to school" keeps the player in the stash.
