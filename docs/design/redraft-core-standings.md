# Redraft /core Standings · Season Outlook · Commissioner · Brackets — batch B6

Surface **B** of [`redraft-tab-inventory.md`](./redraft-tab-inventory.md): the `/core` screens a native redraft
league opens from the AfCoreShell sidebar, on the foundation's tokens
([`redraft-identity.md`](./redraft-identity.md)). Built on CORE-1 (#3095), which stamps `data-format="redraft"`
+ `data-sport` on `.af-core.af-shell` for a native redraft `?league=`.

Other leagues are unchanged: every new rule in `components/core-app/af-core-redraft-standings.css` is scoped
to `.af-core.af-shell[data-format=redraft]` (enforced by `__tests__/core-app/redraft-core-standings-css.test.ts`),
and the two markup additions are an attribute and a `display: contents` wrapper that style nothing outside it.

| file | role |
|---|---|
| `lib/core-app/redraftCoreRace.ts` | pure mappings — the proven race tag, the health ring fill; `null` when unproven |
| `components/core-app/af-core-redraft-standings.css` | every B6 rule; tokens only; one top-level `@media (max-width:640px)` |
| `components/core-app/standings/StandingsBoardView.tsx` | `data-race` on the zone chip (from `redraftRaceTag`) |
| `components/core-app/screens/CommissionerHub.tsx` | the health panel's `display: contents` wrapper carrying `--rdc-health` |
| `app/e2e/redraft-core/standings/<screen>` | DB-free harness: real AfCoreShell + the real screen on fixtures (404 in production) |
| `scripts/redraft-core-standings-capture.mjs` | screen × 7 sports × light/dark × 1440/390, refusing a frame it cannot vouch for |

## Per screen — what shows, and what is dropped without data

| screen | redraft adds | dropped when |
|---|---|---|
| Standings | sport rule under the header; tiles lifted toward the sport, table position marked; stakes panel on a sport edge; **your row** tinted with a leading bar (opaque — the rank/team cells are sticky); **labelled playoff line** in the sport colour, bye line dashed; **Clinched / Clinched bye** chips in the sport fill and **Eliminated** in quiet ink; playoff odds as a **neutral** bar and the stakes percentage in ink (the sport fill only on a row whose clinch is proven — a 67% "good" tone is still a forecast); your-place bars in the sport colour | tags: the board did not prove it (`standingsModel.computeZones` enumerates the remaining games, or bounds them so it can only under-claim) — positional zones keep an outline chip and are never a tag. Odds column: no Season Outlook simulation for the league. **No Champion tag**: /core holds no playoff bracket, so a champion is never knowable here |
| Season Outlook | sport rule; the forecast lifted toward the sport with a sport bar; the Playoffs tile leads; likely ranges as a neutral band with the headline as the sport dot; Clinched pill in the sport fill; selected tab and the clinch panel in the sport | every number is the simulation's; nothing is drawn without it (the screen's own "too few weeks" / no-team branches are unchanged) |
| Commissioner | sport label and badge; sport rule on every section; the weekly checklist on a sport rule with done items ticked in the sport; **league health as a ring** (in ink, not the sport colour — a healthy 84 in MLB's stitch red read as an alarm) | the ring: the engine score is unavailable — the panel keeps its "—" and reason, no ring. The checklist: the route answers `applies: false` (non-redraft) or fails |
| Brackets (Bracket Challenge, `/core/bracket`) | sport rule, current sport chip, match frames, totals and champion slot in the sport | — |

## ⚠ What Brackets is, and why it barely carries the identity

The sidebar's **Brackets** item links to `/brackets` — a public page outside AfCoreShell, not league-scoped
(and in open PR #3076), so no league identity can reach it. `/core/bracket` (the Bracket Challenge) renders
inside the shell, but its sport links drop `?league=`, so it is stamped only when opened directly as
`/core/bracket?league=<native redraft league>`. Its rules are here so that state is not half-themed; the
league's own playoff bracket lives on surface A (`/league/[id]` Standings & playoffs, #3101).

## Not edited, on purpose

`af-standings.css`, `af-outlook.css`, `af-season-outlook*.css`, `af-commish-hub.css` (open in #3082),
`af-format-hubs.css`, `af-bracket.css`, `HubSections.tsx` (open in #3082), `components/commish/*`,
`broadcast-deck.css`, `af-core-lock.css`, `af-player-card.css`, AfCoreShell and the page — every B6 rule
layers on top from its own file.

## Visual review

```
DATABASE_URL=postgresql://u:p@127.0.0.1:1/none DIRECT_URL=$DATABASE_URL \
  node node_modules/next/dist/bin/next dev -p 3646
node scripts/redraft-core-standings-capture.mjs --base-url http://127.0.0.1:3646 --out <dir> --state after --full
```

The database is pinned to an unreachable sentinel because the Commissioner screen's streamed reports call
prisma (they catch the failure and render "unavailable"). "Before" is a git state — shoot it on the base
commit — not a flag.
