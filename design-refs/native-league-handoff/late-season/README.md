# Mid- and late-season Survivor: Codex handoff

This package covers the moments after the weekly loop (`../weekly-loop/`):

1. **Tribe swap**: buffs drop and managers are reshuffled into new tribes.
2. **Merge**: the tribes become one named tribe.
3. **Jury and Final Tribal Council**: the jury votes and a champion is crowned.
4. **Exile boss**: the weekly score the Exile Island managers have to beat to keep their tokens.

The screens in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups: read them for layout, copy and timing, but don't ship them. The SVGs in `assets/` are production assets. `tools/gen_late.py` regenerates every asset.

## Assets

| File | Use |
|---|---|
| `buff-<tribe>.svg` | Tribe buff (260×200): a patterned cloth headband with a knot and tails. Samples for Kaniva, Koa, Honoa and Vela. |
| `buff-merge.svg` | The gold merge buff that everyone wears after the merge. |
| `merge-banner.svg` | Merged tribe banner (260×320), with crossed torches and a medallion where the two tribes join. |
| `jury-bench.svg` / `jury-icon.svg` | Carved jury bench (440×240) and a 64px jury badge. |
| `champion-trophy.svg` / `champion-icon.svg` | Season trophy (260×340): a flaming gold bowl on a carved totem stem. Plus a 64px badge for profiles. |
| `exile-boss.svg` / `exile-boss-icon.svg` | Exile boss: a stone warden mask with glowing eyes (260×320). Plus a 64px icon. |

**Buffs for every tribe:** don't ship 50 static files. Call `buff(primary, secondary, uid)` in `gen_late.py` with the tribe's colours from `../tribes/tribes.json`, at build time or on the server. Every gradient id is prefixed with `uid`, so several buffs can sit inline on one page.

## 1. Tribe swap (`TribeShuffle`, Swap tab)

- **When it happens:** the swap week comes from the league's Survivor settings (`swapWeek`, optional).
- **How the new tribes are drawn:** at random on the server, and sealed until the reveal (the same secrecy model as idols). Store the result as `SurvivorTribeAssignment` rows with a `phase` field.
- **The reveal:**
  1. "Drop your buffs": every buff falls and fades (about 0.7s).
  2. The cards regroup into the new tribe columns with a staggered pop-in (0.12s per card). The new buff drops onto each card.
  3. A manager who changed tribes shows "From {old tribe}" in gold. Everyone else shows "Stays in {tribe}".
- **What carries over:**
  - Idols travel with the manager.
  - Tribe chat switches over at the next lineup lock.
  - Exile tokens are not affected.

## 2. Merge (`TribeShuffle`, Merge tab)

- **When it happens:** at `mergeWeek`, or when the number of remaining managers reaches `mergeAtCount`.
- **The reveal:** the two tribe crests slide together and fade (0.9s), then the merge banner pops in. The headline changes to "Welcome to {name}".
- **Naming the merged tribe:** the commissioner picks a name, or the remaining managers vote on one. Suggest three unused names from the tribe name pool. All names are original; don't use names from the TV show.
- **What changes after the merge:**
  - Immunity goes to the top single score in the league, not per tribe.
  - Everyone voted out from here on joins the jury (`isJuror = true`).
  - Everyone wears `buff-merge.svg`.

## 3. Jury and Final Tribal Council (`JuryFinale`, `MobileFinale`)

- **The jury:**
  - Jurors sit on the bench with their avatars desaturated (`saturate(.35) brightness(.85)`), the jury badge, and the week they went out.
  - Jurors can't play and can't receive votes. They can still chat.
- **The finalists:**
  - The number of finalists is set by `finalistCount` (2 or 3).
  - Each finalist card shows their season record, computed from history:
    - immunity wins
    - idols played
    - season points
    - votes survived
- **Jury voting:**
  - Each juror votes once, in secret, before `juryDeadlineAt`. Use the same ballot UI as `../weekly-loop/VoteCast`, but only finalists can be picked.
  - Show nothing until every juror has voted or the deadline passes.
- **The reveal:**
  - Votes are read one at a time (0.9s apart on desktop; a tap per vote on phone).
  - Each vote lands as a parchment slip, and a tally mark is added to that finalist.
  - Read the votes in a suspenseful order: alternate between finalists, and save the deciding vote for last.
- **Ties:**
  - A tie on the jury vote is broken by season points.
  - The tiebreak rule is shown on the scroll before the reveal.
- **Champion:**
  - The trophy card pops in with a pulsing glow, and the line "**{Manager} is the last one standing**".
  - The champion badge is added to their profile, and the season is written to league history.
  - The phrasing is original; don't use the TV show's catchphrases or title phrases.

## 4. Exile boss (`ExileBoss`)

- **What the boss is:** a weekly score, not a person. How it's set comes from Survivor settings, `exileBossMode`:
  - `median`: the median of all active managers' scores that week. This is the default.
  - `fixed`: a number the commissioner sets.
  - `topN`: the average of the top N active scores.
- **The Exile board:**
  - Each Exile manager gets a bar against a red boss line.
  - **Live:** the boss score and each bar update as games finish. Gold bars, with "Ahead" or "Behind" chips and projections.
  - **Final:** green bars mean safe or won the week. Red bars mean wiped, and those coins switch to `token-coin-wiped.svg`.
- **Outcome toasts:** use the two cards on the screen: "You beat the boss" and "The boss wins". They connect to the token toasts in `../exile/`.
- **Motion:** the boss mask hovers and its eyes pulse. Both stop under `prefers-reduced-motion`.

## Accessibility

- Every animation listed here has a `prefers-reduced-motion` fallback that shows the end state straight away.
- Tally marks and colour are never the only signal: the vote count is always shown as a number next to them.
- Tap targets on phone are at least 44px.
