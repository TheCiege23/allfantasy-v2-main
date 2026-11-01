# Redraft identity on /core — B5: Waivers, Player Finder, Draft HQ

Batch B5 of the redraft visual upgrade (2026-10-31). Builds on the foundation
(`docs/design/redraft-identity.md`, #3087) and the /core shell stamp (#3095 `data-format="redraft"` +
`data-sport` on `.af-core.af-shell`, #3109 `isImportedRedraftLeague`). Stacked on #3109.

**Which leagues.** `/core?league=<native id>` redirects to `/league/[id]`, so /core renders these three
screens for **imported** leagues only. The stamp — and so every rule here — applies when the import's
stored data positively says plain redraft (`isImportedRedraftLeague`). Dynasty, keeper, best ball,
guillotine and any import the rule cannot vouch for keep the default look; the capture script's dynasty
control proves it pixel for pixel.

## Files

| file | what |
|---|---|
| `components/core-app/af-core-redraft-waivers-finder.css` | every rule under `.af-core.af-shell[data-format=redraft]`; tokens only; one top-level `@media` |
| `components/core-app/screens/Waivers.tsx` | imports the sheet; `data-tile` on each tile; the FAAB bar (`faabTrack`) |
| `components/core-app/screens/PlayerFinder.tsx` | imports the sheet (one line) |
| `components/core-app/screens/DraftHq.tsx` | imports the sheet (one line) |
| `app/e2e/redraft-core/b5/…` | DB-free harness: real `AfCoreShell` + real screen + fixture data, 404 in production |
| `scripts/redraft-core-b5-capture.mjs` | before/after capture, refuses frames it cannot vouch for, pixel-diffs the dynasty control |
| `__tests__/core-app/redraftCoreB5Css.test.ts` | scope / colour / 11px / nesting sweep + mutation controls on the real file |
| `__tests__/core-app/waivers-faab-track.test.tsx` | the FAAB bar's honesty rules, testids kept |

Not edited: `af-waivers.css`, `af-player-finder.css`, `af-draft-hq.css`, `broadcast-deck.css` (only its
`--bdx-*` tokens are re-pointed, from this sheet, inside the stamp), the /core page, `coreUiCopy.ts`.
No save path, no behaviour, no new route. No new copy, so nothing to translate (Spanish already says
«reclamo» for a claim on this screen; B5 adds no string).

## Per screen

| screen | change | data it rests on |
|---|---|---|
| Waivers | the next-run line becomes the hero: sport frame + wash, countdown in the accent (`data-soon` keeps `--warn`) | `processTime.schedule` → `WaiverRunClock` (existing) |
| Waivers | FAAB tile is the lead number: accent cap, lifted ground, accent value | `budget.faabRemaining` |
| Waivers | **FAAB bar** — your FAAB left as a share of the league budget | `budget.faabRemaining` ÷ `waiverType.budget`; drawn only when both are real and remaining ≤ budget |
| Waivers | title bar, tile radius, rules box in the sport line, rule budget/time in the accent | — |
| Waivers | Waiver intel embed: the deck's magenta→orange gradient and italic display become the sport accent, upright | WaiverIntel `.bdx-embed-core` |
| Player Finder | **accent restored**: the screen's root is itself `.af-core`, which re-declared the default cyan `--accent` family — so in a redraft league the Search button, "in this league", links and the active match were cyan. Restated on that root | — |
| Player Finder | title bar, active match gets a sport rail, player card in the hero frame + wash, headshot in the sport line | — |
| Draft HQ | board card is the hero (sport cap + frame + wash); a pre-draft status is the sport pill; "Your slot" in the accent | `session` (when AllFantasy runs the draft) |
| Draft HQ | pick labels and pick chips in the sport; section labels get the B2 sport bar | `pickSlots`, `madePicks` |
| Draft HQ | **your picks on the board were unreadable in both modes** — `af-draft-hq.css` paints them `--accent-ink` on `--accent-soft` (white on a 10% tint in light, near-black on a 16% tint in dark). In redraft: `--text` on the tint with a sport rail; same for your team-strip chip; a "B" grade letter becomes `--text` on a chip (not the sport colour — MLB's accent is red, and a red B reads as failing) | `board`, `grades` |

## Dropped — no data supports it

| idea | why not |
|---|---|
| Draft countdown on Draft HQ | `DraftHqData.session` carries status, type, rounds, teams, your slot — **no start time**. And an imported league has no AllFantasy session at all (`no upcoming draft is scheduled in AllFantasy…`). Nothing to count down to. |
| Sport-correct position filters in Player Finder | Player Finder has **no position filter** — it is a name search. Adding one is a behaviour change, out of scope. |
| Position tone chips in Player Finder / Draft HQ | The sport-aware tone table lives in unmerged #3101 (`redraftPositionTone`) and #3106 (`redraftCorePosTone`); neither is importable from this branch's base, and a third copy is what the brief asked to avoid. Follow-up once either merges. |
| A claim-processing window ("claims lock in …") separate from the run | Only the run schedule is stored (`processTime`); there is no separate lock time to show. The next-run line is the window. |
| Mock's league-type / sport pills in the screen header | Already carried by the shell stamp (top bar, nav); repeating them per screen would add copy without data. |

## Capture

`node scripts/redraft-core-b5-capture.mjs --base-url <local next dev> --out <dir>/after --state after --compare <dir>/before`

Before = the same tree with the sheet emptied (the stamp is on in both; the stamp is #3095/#3109's change,
not this one). Each frame must read `data-format=redraft`, the right `data-sport`, the right `html[data-mode]`,
`--accent` = the sport's `--rd-accent-text`, and the sheet's `--rd-b5: on` marker (after) / its absence
(before). Each dynasty control must read no stamp and no marker, and with `--compare` must be pixel-identical
to its before twin. The clock is pinned so the waiver countdown cannot make two runs differ.
