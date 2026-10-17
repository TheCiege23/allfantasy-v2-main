# C2C · Campus to Canton: Codex handoff

Source of rules: spec in repo: `docs/PROMPT1_MERGED_DEVY_C2C_IMPLEMENTATION_PLAN.md`

The screens in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups: read them for layout, copy and timing, but don't ship them. The SVGs in `assets/` are production art. `../shared/sp.css` holds the shared styles, and `../tools/gen_*.py` regenerates every asset.

- **Art:** `emblem.svg` is the format crest. Use it on league cards, the league switcher and create-a-league. `banner.svg` (1600×500) is the hero background. It is set to slice, so crop it with `object-fit: cover`. The `icon-*.svg` files are 64px status icons.
- **Accessibility:** every animation has a `prefers-reduced-motion` fallback that shows the end state straight away. Colour is never the only signal; there is always a text tag as well.

## Screens
- **`C2CHome`:**
  - Two lineups side by side: **Campus** (NCAAF, Saturday) and **Pro** (NFL, Sunday). Together they make your weekly score.
  - A matchup bar shows the campus share of your score.
  - College rights about to graduate.
- **`C2CDraftBoard` (signature moment):**
  - The merged startup draft board: college rounds (orange) alternate with pro rounds (gold), snake order, and your column is highlighted.
  - The All / College / Pro filter dims the other rounds.
- **`MobileC2C`:** Campus / Pro tabs with the lineup, and a week total.

## Notes
- The repo plan says C2C is dynasty-only, NFL and NCAAF only. Two lineups summed into one score is the merged model in the plan; confirm the final scoring split.
- **Name:** "Canton" refers to the city only. Don't use any Hall of Fame marks.
