# Zombie: Codex handoff

Source of rules: spec in repo: `docs/PROMPT351_ZOMBIE_LEAGUE_PRODUCT_SPEC.md`

The screens in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups: read them for layout, copy and timing, but don't ship them. The SVGs in `assets/` are production art. `../shared/sp.css` holds the shared styles, and `../tools/gen_*.py` regenerates every asset.

- **Art:** `emblem.svg` is the format crest. Use it on league cards, the league switcher and create-a-league. `banner.svg` (1600×500) is the hero background. It is set to slice, so crop it with `object-fit: cover`. The `icon-*.svg` files are 64px status icons.
- **Accessibility:** every animation has a `prefers-reduced-motion` fallback that shows the end state straight away. Colour is never the only signal; there is always a text tag as well.

## Screens
- **`ZombieHome`:**
  - **Universe map:** levels Alpha, Beta and Gamma.
    - Each league card has a 20-cell strip showing its Whisperer (purple), Zombies (green) and Survivors (blue).
    - Your league is highlighted.
  - **Danger matchup card:** shown when your opponent is a Zombie or the Whisperer.
  - **Supplies:** serum, weapon and ambush (Whisperer only).
  - **Weekly board** feed.
- **`ZombieInfection` (signature moment):**
  - Shows your result after the weekly infection run.
  - If you're bitten and hold a serum, you choose **Use my serum** (you become Revived and stay a Survivor) or **Keep it, turn**. Turning runs a green hue animation.
  - The infection log lists every result, with who infected whom.
- **`MobileZombie`:** your status, the danger matchup, supplies and a "use weapon" call to action.

## Placeholders to confirm
- Weapon effect: "+6 points".
- Serum timing: at the infection run.

The spec says items work "per rules" without exact values.
