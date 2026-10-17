# Salary Cap: Codex handoff

Source of rules: spec in repo: `docs/PROMPT337_SALARY_CAP_LEAGUE_PRODUCT_SPEC.md`

The screens in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups: read them for layout, copy and timing, but don't ship them. The SVGs in `assets/` are production art. `../shared/sp.css` holds the shared styles, and `../tools/gen_*.py` regenerates every asset.

- **Art:** `emblem.svg` is the format crest. Use it on league cards, the league switcher and create-a-league. `banner.svg` (1600×500) is the hero background. It is set to slice, so crop it with `object-fit: cover`. The `icon-*.svg` files are 64px status icons.
- **Accessibility:** every animation has a `prefers-reduced-motion` fallback that shows the end state straight away. Colour is never the only signal; there is always a text tag as well.

## Screens
- **`SalaryCapHome`:**
  - **Cap bar:** active contracts, dead money (red) and rollover credit (gold stripes).
  - **Future-years columns:** committed money against a dashed cap line. The cap grows 5% a year, per the spec defaults.
  - **Contracts table:** status tags for extension eligible, rookie deal, expiring or tag candidate, and cut with dead money.
  - **Offseason calendar:** extension window, franchise tag deadline, rookie draft, free-agent bidding.
- **`SalaryCapBid` (signature moment):** a blind free-agent bid.
  - Salary stepper with a button that sets it to the AF value.
  - Years: 1–4.
  - A live cap preview for each future year.
  - Validation turns red and blocks the bid when it would take you over the cap.
- **`MobileSalaryCap`:** cap space, expiring contracts and next year's cap.

## Defaults used, from the spec
- NFL cap $250, growing 5% a year.
- Dead money: 25% of remaining salary per remaining year.
- Rollover up to $25.
- Contracts of 1–4 years.
