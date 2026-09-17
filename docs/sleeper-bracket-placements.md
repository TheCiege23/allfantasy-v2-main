# Sleeper playoff brackets: champion, runner-up and finish

2026-09-17. This note goes with the fix in `lib/league-import/sleeper/bracketPlacements.ts`.
It covers what was wrong, what the fix changes, and two follow-ups that were written
down but not run:

- a backfill for rows already stored;
- storing bracket placements in `legacy_rosters.finalStanding`.

All counts below come from the `.env.test` copy of production (`ep-muddy-leaf`), measured
read-only on 2026-09-17. Re-measure on production before acting on any of them.

## What was wrong

Sleeper's `winners_bracket` puts every placement game in the **same last round**: the
title game (`p: 1`), the third-place game (`p: 3`), and in larger brackets the fifth- and
seventh-place games (`p: 5`, `p: 7`). `p` is the placement the winner takes; the loser
takes `p + 1`.

| Writer | Old rule | Effect |
|---|---|---|
| `SleeperHistoricalMatchupSyncService.analyzePlayoffBracket` → `league_dynasty_seasons.metadata.playoffStructure.playoffFinishByRosterId` | every last-round winner is champion, every last-round loser is runner-up | **Every** row with a decided final holds 2–4 champions: 423 rows with 2, 16 with 3, 77 with 4 (516 of 516) |
| `syncLeagueHistory.parseChampionFromBracket` → `league_seasons` | `finals.find(m === 1) ?? finals[0]`; `m` is bracket-wide, so this is always `finals[0]` | Latent. All 189 comparable rows agree with the corrected result, because Sleeper happened to list the title game first |
| `ImportedLeagueCommitService` and `applySleeperLeagueSync` → `league_seasons` for the current season | once the season is `complete`, standings rank 1 is champion and rank 2 is runner-up | Latent. For Sleeper, `standings[].rank` is a wins-then-points sort (`SleeperHistoryMapper`), so this would have named the regular-season #1 and #2. The daily sync would have rewritten it on every run. No current row carries it, because no current-season league has completed since `seasonPlacement.ts` gated the write. The 2026 seasons complete in January 2027. |
| `lib/legacy-import.ts` → `legacy_rosters.finalStanding` | `isChampion ? 1 : settings.rank` | A regular-season rank, set on 19 of 1,121 owner rosters. Two rows have `finalStanding = 1` without `isChampion`. **Not changed** — see "Follow-up 2". |

`lib/league-history/sleeperLeagueHistoryService.ts` already read `p === 1` correctly, and
the new module is that rule, shared.

## What the fix does

`resolveBracketPlacements(bracket)` returns the champion, the runner-up, every placement
a decided `p` game settled, and how the title game was identified:

- **`placement`**: the title game is the `p: 1` game.
- **`inferred`**: no game carries `p`. This is the case for every bracket stored before
  this fix, because the flattener dropped `p` and `t*_from`. The title game is then the
  one last-round game whose two teams had not lost earlier in the bracket. If zero or
  several games fit, nothing is inferred.
  - On the test copy this identified the final in all 516 stored brackets with a decided
    final.
  - The other 209 brackets have no decided game at all: 195 are 2026 seasons and 14 are
    older.

The four writers now use it:

- **`analyzePlayoffBracket`** now lives in the pure module. It produces exactly one
  champion and one runner-up.
  - `bestFinish` comes from the placement games.
  - `playoffWins` and `playoffLosses` count only games on the path to the title, so a
    fifth-place-game win is no longer a playoff win.
  - The stored metadata gains `championRosterId`, `runnerUpRosterId`, `titleGameSource`
    and `bracketPlacementVersion: 2`.
  - The stored bracket now keeps `placement`, `team1From` and `team2From`.
- **`syncLeagueHistory`** now takes the `p: 1` game.
  - The champion alone falls back to `winner_roster_id`, then
    `metadata.latest_league_winner_roster_id`. The runner-up has no fallback.
  - It writes a champion only once the season is `complete`.
- **The Sleeper import payload** now fetches `winners_bracket` when the season is
  `complete`. `SleeperAdapter` turns it into `season_placement`.
  - `seasonPlacementTeamIds` uses that result for Sleeper, and nothing otherwise.
  - Other providers keep the standings fallback they had.
  - `sleeperScopeFetcher` adds the placement to the `league_state` checkpoint, only when
    one is present. That makes completed leagues re-apply once and correct their row.

What counts as a **title** in career and rank code is unchanged:
`legacy_rosters.isChampion` still comes from `winner_roster_id` in `lib/legacy-import.ts`.

## Follow-up 1: backfill for stored rows (not run)

### `league_dynasty_seasons`: recompute offline, no Sleeper calls

Every decided stored bracket can be corrected from what is already in `metadata`.

1. **Select** rows where `provider = 'sleeper'`, `metadata->'playoffStructure'->'winnersBracket'`
   is non-empty, and `bracketPlacementVersion` is absent (this makes it idempotent).
2. **Map** the stored games `{round, matchup, team1, team2, winner, loser}` to
   `{r, m, t1, t2, w, l}`.
3. **Recompute** with `analyzePlayoffBracket(games, rosterIds)`, where `rosterIds` are the
   keys of the existing `playoffFinishByRosterId`. Keep each entry's `playoffSeed` and
   `canonicalRosterId`, recompute `label`, and set:
   - `championRosterId` and `runnerUpRosterId`;
   - `titleGameSource: 'inferred'`;
   - `bracketPlacementVersion: 2`.
4. **Write back** with a JSON merge, not a replace, so `matchupHistory` and the rest of
   `playoffStructure` survive.
5. **Dry run first.** Print, per row, the old and new champion counts. Expect 516 rows to
   change from 2+ champions to 1, and 209 rows with no decided game to be left alone.

**Limit.** A stored bracket has no `p`, so third-place and lower games cannot be told
apart. After the recompute:

- third and fourth both read 3;
- quarterfinal losers all read 5.

Champion and runner-up are exact. To get the lower placements too, refetch
`/league/{platformLeagueId}/winners_bracket` for each row: one call per row, 801 rows,
674 distinct Sleeper league ids.

**Urgency is low.** Nothing in the codebase reads `playoffFinishByRosterId` today (checked
2026-09-17), so these rows are wrong but unread.

⚠ **The 801 rows cover only 674 distinct Sleeper league ids**, because two `League` rows
can point at one Sleeper league. Correct each row on its own. Do not dedupe as part of
this backfill.

### `league_seasons`: check, then leave alone

Nothing measured needs correcting today. Before closing this out on production, run the
same comparison the test copy used: for each Sleeper row with `teamRecords`, compare the
`isChampion` / `isRunnerUp` roster ids against the inferred result from the matching
`league_dynasty_seasons` row. Any row that disagrees is fixed by re-running
`syncLeagueHistory` for that league (ingestion; Sleeper calls allowed there), not by
editing JSON by hand.

The standings writers need no backfill: they never wrote a champion for an unfinished
season, and they now use the bracket before any season finishes.

## Follow-up 2: bracket placement in `legacy_rosters.finalStanding` (not done)

**Proposed rule for future legacy imports.** Apply it in `lib/legacy-import.ts` and in
the second writer with the same rule, `server/api-route-modules/legacy/backfill/playoffs/route.ts`:

```
finalStanding =
  isChampion (from winner_roster_id)          → 1
  roster played in the winners bracket        → its placement (p games), else its elimination band
  otherwise                                   → null      (never settings.rank)
```

When the bracket names someone else as the `p: 1` winner than `winner_roster_id` does,
store `null` for both rosters rather than two firsts.

Nothing is lost by dropping `settings.rank` from this column: the same row already stores
it in `LegacyRoster.rank`.

⚠ **The playoffs backfill route also reads the value it writes.** Around line 144,
`legacy/backfill/playoffs/route.ts` derives a missing `playoffSeed` from
`finalStanding <= playoffTeams`. Under the new rule a placement is not a seed. That line
must switch to `rank`, which is what `legacy-import.ts:529` already uses. (The Prisma models have no `@@map`, so the tables are
`"LegacyRoster"` and `"LegacyLeague"`.)

### Is it safe for the readers?

| Reader | How it uses `finalStanding` | Verdict |
|---|---|---|
| `lib/rank/careerLedger.ts` `legacyMadePlayoffs` | seed first, else `finalStanding <= playoffTeams`, gated on games played | **Safe, and more correct.** A bracket placement never exceeds the bracket size (`playoff_teams`). Non-playoff rosters become `null`; today a regular-season rank ≤ the cut credits a berth nobody earned. |
| `lib/core-app/career.ts` (and the `careerModel` rows from #981) | `seed <= cut \|\| finalStanding <= cut`, gated on games | **Safe**, same reason. |
| `lib/legacy-ai-context.ts`, `server/api-route-modules/legacy/ai/run/route.ts` | passed to the AI payload as `finalStanding` / `final_standing` | **Safe, but the meaning changes** from "regular-season rank" to "playoff finish". Label it in the prompt text when this lands. |
| `lib/chimmy-context/providers/RankingContextProvider.ts` | counts a playoff appearance whenever `finalStanding > 0`, with **no cut check** | **Safe only under the proposed rule, and then more correct than today.** Today every row holding a regular-season rank counts as a berth. Under the rule, non-playoff rosters become `null`. Placements must stay limited to winners-bracket rosters: storing losers-bracket places (7th–12th) would bring the over-count back. |
| `lib/ranking/computeAndSaveRank.ts`, `lib/leagues/copyLegacyStatsToImportedLeague.ts`, `server/api-route-modules/legacy/profile/route.ts`, `.../legacy/rank/refresh/route.ts`, `app/api/user/rank/route.ts` | `finalStanding <= playoffTeams`; titles come from `isChampion` | **Safe.** `copyLegacyStatsToImportedLeague` copies the value into `import_final_standing`, where it now means a finish rather than a rank, which is what that column is named for. |

**Existing rows do not change until they are re-imported.** A backfill from
`league_dynasty_seasons` is possible by joining `LegacyLeague.sleeperLeagueId` to
`platformLeagueId` and `LegacyRoster.rosterId` to the bracket roster id. It reaches only
191 of 986 completed owner rosters (19%) on the test copy, so re-import is the main path.

## The career page's "Finals" (wired 2026-09-17)

`CareerAccomplishments.finals` in `lib/core-app/careerModel.ts` is now titles plus finals
lost. A lost final is the losing side of a stored Sleeper title game. The work is split
across three files:

- **`lib/league-import/sleeper/bracketPlacements.ts`**, `readStoredTitleGame`:
  - A `bracketPlacementVersion: 2` row is read as stored.
  - An older row is resolved from its flattened `winnersBracket` with the same rule.
  - ⚠ The fallback is what makes this work before any backfill. The sync never rewrites
    a completed season, so on the test copy no row carried version 2 yet.
- **`lib/core-app/careerFinalsResolve.ts`** matches each career row to its stored season
  and finds the manager's roster:
  - Legacy and import rows match by Sleeper league id and season.
  - Imported season history matches by `League.id` and season.
  - The roster is the legacy roster, or else the claimed team traced back through the
    stored `canonicalRosterIdByHistoricalRosterId` map (unique matches only).
- **`lib/core-app/careerFinals.ts`** sums the results for the tile. A season whose bracket
  names the manager champion but whose row records no title is reported, not counted.

`finalStanding` is still not read, for the reason below: old rows hold a regular-season
rank there, and nothing marks which rows were written under any new rule. If follow-up 2
ships, it needs **a marker** before the career page can use it. No existing column can
serve: `LegacyLeague` and `LegacyRoster` carry only `createdAt` and `updatedAt`, and
`updatedAt` moves on every write. The marker therefore needs a new column, which means a
migration and is the user's call.

## A season stored before it finished (fixed 2026-09-17)

**The bug.** The four-hourly `sleeper-historical-refresh` used to skip any season that was
`complete` and already had matchup facts. A season first stored while it was still being
played kept its undecided bracket after it finished, so its final was never readable.

**The fix.** `isStoredSeasonSettled` in `SleeperHistoricalMatchupSyncService.ts` now also
requires the stored row to be settled, meaning either:
- its bracket names a decided title game, or
- it was written while Sleeper already reported the season `complete`. Each write now
  stamps `metadata.seasonStatusAtSync` with Sleeper's status at that moment.

**The stamp limits this to one extra refresh.** Elimination formats never get a winners
bracket, so a gate on the title game alone would re-fetch them on every run.

⚠ **A failed bracket fetch during that one refresh is not retried.** `getPlayoffBracket`
returns `[]` both for a failed request and for a league with no bracket, so the two cannot
be told apart.

**Watching it.** Each run of the cron reports the gate under `metadata.matchupSeasons`, both
in its response (which the slow-tier Actions log prints) and in its `SyncJobRun` row:

| Field | Meaning |
|---|---|
| `processed` | Seasons fetched and written |
| `skippedComplete` | Settled seasons left alone |
| `completedRefreshed` | Finished seasons fetched once more |
| `leaguesWithError` | Leagues whose matchup sync reported an error but still count as refreshed |

After deploy, `completedRefreshed` should be non-zero for a few runs, then drop to zero.

Measured on the test copy, read-only, 2026-09-17:

| Sleeper dynasty rows without a decided title game | Count |
|---|---|
| All | 285 of 801 |
| 2026 (in progress, not gated) | 229 |
| Older, empty bracket | 42 |
| Older, bracket games present but none decided | 14 |

- **The 14 older rows are not this bug.** They were written on 2026-09-01/02, long after those
  seasons ended, and 12 of them have no matchup facts at all, so the old gate never skipped
  them either.
- **29 older rows get one extra refresh after deploy.** They have matchup facts but no
  settled row: 27 with empty brackets and 2 undecided. At 21 Sleeper calls each, that is a
  one-time cost.
- **The 516 rows with a decided title game stay skipped.**
