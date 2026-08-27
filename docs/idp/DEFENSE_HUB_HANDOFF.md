# Defense Hub — build handoff

**For:** Claude Design
**Surface:** `/idp/defense-hub/[leagueId]`
**Written:** 2026-08-25, after the IDP projection/valuation stack landed on `main`.

---

## The one rule

Every number on this page must be traceable to a row in Postgres or refuse to
render. Not a placeholder, not a plausible-looking default, not a hash of the
player id. If we cannot compute it, the panel says what is missing and why.

This is not a style preference. The Defense Hub currently ships numbers that
look authoritative and are invented, and the whole point of this rebuild is that
a manager can act on what they read.

Three corollaries, all of which the backend already obeys:

- **Null is not zero.** A defender with no projection is not a defender
  projected for zero points. Render an absence as an absence.
- **Say what the basis was.** "73%" invites the reader to assume a full season.
  "73% · defensive snaps · 37 games" does not.
- **Refuse rather than approximate.** Every loader below returns a `skipped`
  reason or an unavailable state. Show that reason; it is more useful than a
  number nobody can defend.

---

## What the page is today

`app/idp/defense-hub/[leagueId]/DefenseHubClient.tsx` is a static mock end to
end. There is no fetch on the page. Specifically:

| Line | What it does |
| --- | --- |
| `:13` | `const MOCK_IDS = ['def1', 'def2', 'def3']` — three fake ids, the entire population of the page |
| `:21–25` | Table rows: every player is literally named `` `Defender ${i + 1}` ``, team `'NFL'`, position `'LB'` |
| `:22` | Points come from `mockIdpPoints(id, 1)` — a hash of the id string |
| `:23` | Salary is `4 + i * 2.5`. The `Pts/$M` column and the default sort are built on it |
| `:29–34` | Snap tracker rows: `last: 60 + i`, `thisWeek: 62 + i`, trend cycles on `i % 3` |
| `:37–42` | Matchup rows: opponent is `` `@OPP${i}` ``, grade cycles on `i % 3`, note alternates between two hardcoded strings |

The fabrication is not confined to this page. `app/idp/components/idpPositionUtils.ts`
is a module of invented data — `mockIdpPoints`, `mockStatPills`,
`mockContractSalaryM`, `mockYearsRemaining`, and `idpRoleLabel`, which assigns
"Run Stopper" / "Edge Rusher" / "Coverage" by summing character codes. Six
components import from it:

```
app/idp/components/IDPDraftFilters.tsx
app/idp/components/IDPMatchupView.tsx
app/idp/components/IDPPlayerCard.tsx
app/idp/components/IDPPlayerModal.tsx
app/idp/components/IDPTeamDashboard.tsx
app/idp/defense-hub/[leagueId]/DefenseHubClient.tsx
```

`IDPPlayerCard.tsx:62` deserves a special mention because it is the exact bug
this handoff exists to prevent:

```ts
const snapShare = 40 + (Math.abs(playerId.charCodeAt(0) ?? 0) % 55)
```

That renders as a percentage next to a real player's name. Real snap data was
on disk the entire time it has been shipping.

**Scope note:** you are asked to build the Defense Hub. The other five
components share the same mock module, so deleting `idpPositionUtils` outright
will break them. Leave them alone unless you also fix them; just do not add new
callers.

---

## What is real, and where

Read these in order. The first four are the ones you will actually call.

### 1. `lib/idp-projections/loadIdpProjections.ts`
Per-player, per-week IDP stat lines assembled from `PlayerGameStat`, merged with
any vendor projection (`mergeIdpStatLine` — the vendor wins where it spoke).
Returns a `LoadIdpProjectionsResult` carrying an `IdpProjectionCoverageReport`,
so you can tell the reader how much of the board was actually projected.

### 2. `lib/idp-projections/leagueIdpVorp.ts` — **your main entry point**
`loadLeagueIdpVorp(args)` takes the league, its `roster_positions`, and every
rostered Sleeper id, and returns:

```ts
{
  vorpBySleeperId:         Map<string, number | null>  // null = replacement could not be priced
  positionRankBySleeperId: Map<string, number>         // rank within his own group
  valueBySleeperId:        Map<string, number>         // 0–10000, the trade engine's scale
  skipped: null | 'no_scoring_settings' | 'not_an_idp_league' | 'no_rostered_defenders'
                | 'no_projection_history' | 'valuation_refused'
  coverage: { defenders: number; projected: number; priced: number }
}
```

`skipped` and `coverage` are the page's honesty budget. Render them.

Two traps this function documents and you must respect:

- **`leagueId` accepts either id space.** `League.id` is an AllFantasy uuid;
  `platformLeagueId` is Sleeper's numeric string. The loader resolves both. Your
  route param may be either — do not "normalise" it.
- **An empty map means "keep what you had", not "zero".** If you treat an empty
  result as zeros you will silently render a whole league of defenders at 0.

### 3. `lib/core-app/scoringNotes.ts`
`hasIdpScoring(scoring)` is the **strict** predicate and the only correct one.
The loose version — checking for bare `sack` / `int` / `ff` — matches the
team-defence block every Sleeper league ships and reports 64 of 110 leagues as
IDP. The strict predicate reports 10, and zero of eleven sampled false positives
rostered a single defender. `isIdpPosition(position)` is here too.

If `hasIdpScoring` is false, the Defense Hub is not a page this league should
see. Say that, and link out.

### 4. `lib/core-app/snapShare.ts` — snap share, already lifted for you
`loadSnapShares({ prisma, sport, players, gamesPerPlayer })` takes a roster and
returns a `Map<sleeperId, SnapShareOutcome>` — available with
`{ share, snaps, teamSnaps, games, basis }`, or unavailable with a reason naming
the columns it looked for. `loadSnapShare(prisma, player)` is the one-player
form; `getPlayerDetail` calls it, so the player page and this page compute the
same number from the same code.

It encodes three decisions you need:

- Defenders read `def_snp` / `tm_def_snp`; everyone else reads `off_snp` /
  `tm_off_snp`. A linebacker's `off_snp` is special-teams noise.
- It **sums totals and divides once**. It does not average per-game shares — a
  four-snap cameo must not count as much as a sixty-snap start.
- It slices the game cap **per player**, not across the query. Do not "optimise"
  that into a single `take` — a player whose games are all older than everyone
  else's would drop out and read as untracked.

Coverage on the columns: `off_snp` 77% of game rows, `tm_off_snp` 89%,
`def_snp` 58%, `tm_def_snp` 70%.

The rendered result of that computation is live on the player page today
(`components/core-app/screens/PlayerFinder.tsx`, the "Snap share" tile) — that
is the presentation precedent to match: a percentage, plus the basis and the
game count underneath it.

### 5. `lib/projections/leagueScoring.ts`
`computeLeagueProjectedPoints(componentLine, scoring_settings)` — a dot product
of the stat line against the league's own scoring. **Returns `null`, not `0`,
when no keys match.** Never substitute a default scoring table; format is a
parameter, never a default.

Sleeper *projects* `idp_sack` but leagues *configure* `sack`; `STAT_ALIASES`
bridges them. If you ever find yourself hand-mapping a stat key, that map is
where it belongs.

### 6. `data/team-defense-tendencies.json` (tracked, 23KB)
Per-team, per-season: `playsFaced`, `passRateFaced`, `thirdDownRateFaced`,
`secPerPlayFaced`, `offensePassRate`, `blitzRate`, `meanPassRushers`,
`meanDefendersInBox`. Derived from nflverse (`NFLFASTR+FTN`).

⚠ **These measured *worse* than not using them** when added to the projection
model (MAE 4.681 / 4.696 against a 4.673 baseline, over 5,291 out-of-sample
player-weeks). They are wired but default to strength 0. So: you may use them to
*describe* an opponent ("faces the 3rd-highest pass rate in the league"), and
you may not use them to *predict* points or to grade a matchup as easy/tough.
The description is a fact. The grade would be a claim the data does not support.

---

## Panel by panel

### The ranking table
**Can be real.** Rostered defenders, their league-scored projection, their VORP,
their position rank, sorted. Every column above comes from `loadLeagueIdpVorp`
plus `computeLeagueProjectedPoints`.

**Must be refused:** the `$M` and `Pts/$M` columns, and the "Cap efficiency"
sort that is currently the default. Measured against production on 2026-08-25:

```
IDPCapConfig      0 rows
IDPSalaryRecord   0 rows
IDPCapProjection  0 rows
IDPDeadMoney      0 rows
```

The schema and the route (`app/api/idp/cap/route.ts`) are real and correct — the
tables have simply never been populated. So the salary columns have no source
for any league today. Drop them from the default view; if you keep the cap
concept, gate it on a league that actually has an `IDPCapConfig` and show an
empty state otherwise. Do not ship a page whose default sort cannot be computed.

### Snap share tracker
**Can be real** as a share with its denominator, per the computation in `playerFinder.ts`.

**Cannot be real in its current shape.** `SnapShareTracker` takes
`{ last: number; thisWeek: number; trend }` — a week-over-week delta. Today is
**2026-08-25**; the season opens **September 3**. There is no "this week" to
compare against, and there will not be until Week 2. Either:

- render the season-to-date share with its game count now, and add the delta
  once two weeks of the current season exist; or
- have the component accept a `trend: null` state and render "—, first week"
  rather than computing a delta against a previous season.

The existing subtitle — "Snap data may have a 24–48h delay for some games" — is
honest and worth keeping.

### Defender role cards
**Cannot be built as specified.** `DefenderRoleCard` takes `salaryM`, `years`
and `capEff` (no data, see above) and `snapsPct` (real). The role label it pairs
with comes from `idpRoleLabel`, which is a hash.

We do not have coverage/run-stop/pass-rush snap splits from any provider we
ingest — only total defensive snaps. So "Run Stopper" vs "Coverage" is not
currently derivable. Either drop the role label, or replace it with something we
can actually stand behind from the stat line (tackle share, sack rate, targets
allowed if the column exists — check before you assume it does).

### Matchup difficulty board
**Downgrade it to a tendencies board.** The opponent is real (`SportsGame` — but
read `docs`/the schema first: there are four rows per fixture, and display names
and abbreviations both appear). The opponent's offensive tendencies are real,
from the JSON above.

The easy/avg/tough *grade* is not supported: those features did not improve
projection accuracy, so a grade would assert predictive power we measured and
did not find. Show the tendencies and let the manager grade it.

---

## Constraints you must not break

1. **Do not create a new API route.** The route budget is at a hard ceiling and
   a new route will fail the build. Fold what you need into an existing one —
   `app/api/idp/players/route.ts` is the natural host (it already takes
   `leagueId`, authorises via `canAccessLeagueDraft`, and checks `isIdpLeague`).
2. **Auth: gate it.** Copy the pattern from `app/api/idp/players/route.ts` —
   session → `canAccessLeagueDraft(leagueId, userId)` → 403. Do not invent a
   membership predicate; several already exist and disagree.
3. **`SportsPlayer` has duplicate rows per Sleeper id.** 571 rostered ids
   resolved to 1,329 rows when measured. Dedupe or every count you render is
   inflated. `loadLeagueIdpVorp` already does this internally — match it.
4. **Do not call a sports provider from a request path.** Read Postgres.
   `scripts/check-db-first-api-boundary.mjs` enforces this, and Rolling Insights
   passes its token as a query parameter, so a direct call leaks a live
   credential into any logged URL.
5. **Do not probe the vendors to learn a response shape.** The contracts are
   committed at `contracts/rolling-insights/` and `contracts/thesportsdb/`.

---

## Suggested order

1. ~~Lift the snap-share computation into a shared many-id helper.~~ **Done** —
   `lib/core-app/snapShare.ts`, with `getPlayerDetail` migrated onto it and the
   player page verified unchanged. Call `loadSnapShares`; do not write your own.
2. Extend `app/api/idp/players/route.ts` with a defense-hub payload:
   `loadLeagueIdpVorp` + league-scored projections + snap shares, plus the
   `skipped` reason and `coverage` counts passed straight through.
3. Rebuild `DefenseHubClient` against it. Delete `MOCK_IDS`. The page should
   have no import from `idpPositionUtils` when you are done.
4. Handle the three states properly before styling anything: not an IDP league;
   IDP league with no projection history; partial coverage.
5. Then the panels, in the reduced form described above.

## How to verify

Run these from the repo root:

```bash
node scripts/ts-error-ratchet.mjs
```

```bash
npx vitest run --pool=forks
```

```bash
node scripts/check-db-first-api-boundary.mjs --changed
```

The db-first guard reports pre-existing violations across the repo; CI runs it
in `--changed` mode, so it only stops you on files you touched. If it fires,
check whether the violation predates your change before treating it as yours.

The browser preview cannot run from a git worktree on this machine — webpack
resolves Next's client runtime through the cross-drive `node_modules` junction
and fails to build a client bundle. Verify data paths by executing them under
`vitest` with a real Prisma client injected via `vi.mock('@/lib/prisma', …)`;
that is how the snap-share numbers above were confirmed.

**This repo is public. Secret-scan every diff before pushing.**
