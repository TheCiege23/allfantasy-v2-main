# Big Brother: Codex handoff

Source of rules: spec in repo: `docs/PRD_BIG_BROTHER_LEAGUE.md`, `docs/UX_FLOWS_BIG_BROTHER_LEAGUE.md`

The screens in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups: read them for layout, copy and timing, but don't ship them. The SVGs in `assets/` are production art. `../shared/sp.css` holds the shared styles, and `../tools/gen_*.py` regenerates every asset.

- **Art:** `emblem.svg` is the format crest. Use it on league cards, the league switcher and create-a-league. `banner.svg` (1600×500) is the hero background. It is set to slice, so crop it with `object-fit: cover`. The `icon-*.svg` files are 64px status icons.
- **Accessibility:** every animation has a `prefers-reduced-motion` fallback that shows the end state straight away. Colour is never the only signal; there is always a text tag as well.

## Screens
- **`BigBrotherHome`:**
  - **Phase tracker:** HOH, then Nominations, Veto comp, Veto meeting, Eviction vote, Live eviction. The current phase is pink.
  - **Spotlight cards:**
    - **Head of Household:** the key icon and gold ring.
    - **On the block:** the two nominees, with pink rings.
    - **Veto holder:** the medallion and blue ring.
  - **Houseguest grid:** every houseguest is tagged HOH, Veto, Nominee, Safe, You, Jury or Evicted. Evicted and jury managers are greyscale.
- **`BigBrotherEviction` (signature moment):**
  - Votes are sealed until "Reveal the vote". The count then runs up one vote at a time (0.65s apart).
  - The evicted nominee's card gets the door icon and **EVICTED**.
  - Only the result and the count are shown. **Who voted for whom is never shown until the season ends** (PRD §5.5).
- **`MobileBigBrother`:** the HOH picks two nominees. They can't pick themselves or anyone already out. The button reads "Lock in X and Y".

## Rules shown, from the PRD
- Fantasy points decide HOH and the Veto.
- An evicted manager loses their team, and all their players go to waivers.
- Pending trades are cancelled.
- The jury starts at the configured threshold.

## Avoid
- The show's eye logo.
- The show's catchphrases. The copy uses "Open Team 9 is evicted, 5 votes to 3."
