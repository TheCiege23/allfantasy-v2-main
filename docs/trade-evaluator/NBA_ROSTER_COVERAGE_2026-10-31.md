# NBA trade evaluator roster coverage — 2026-10-31

Measured with `scripts/audits/nba-trade-coverage.cjs`. The script reads only a named database and runs every query in a read-only transaction. It prints counts, not player names or IDs.

| Source | Staging NBA leagues | Production NBA leagues | Production teams with unique roster | Production roster player references | Identity matches | Regular-season rows for matched identities |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Native | 0 | 0 | 0 | 0 | — | — |
| Sleeper | 0 | 0 | 0 | 0 | — | — |
| ESPN | 0 | 0 | 0 | 0 | — | — |
| Fantrax | 0 | 1 | 10/10 | 140 | 133/140 | 133/133 |

The production Fantrax league has seven roster IDs without an NBA `PlayerIdentityMap` match; five are listed as starters. The stored Fantrax snapshot has names for all seven, but none yields a unique name-and-position match to the current registry. An automatic identity backfill would therefore risk attaching the wrong player. No identity rows were changed.

The one Fantrax league has no stored scoring mode or numeric points rules. The 16 production `manual` NBA league records have no scoring rules sufficient for the points evaluator, and their 44 `LeagueTeam` rows do not match a stored `Roster` row by the native roster ID key. Staging has 24 `manual` NBA league records and no native, Sleeper, ESPN, or Fantrax NBA league records. No current database provides a verified NBA points-league trade fixture.

The audit's season metric means a regular-season `PlayerSeasonStats` row with games played exists under an identity ID or provider alias. It does not prove that every custom scoring stat is present or that the evaluator can price the player. The evaluator continues to refuse a verified lineup grade when any selected roster player cannot be identified or scored.

The live Fantrax import preserves `scoringSystem.type` and selects among CFB, NFL, and NBA player directories. The [supplied Fantrax league](https://www.fantrax.com/fantasy/league/51isdapqmt6atvdz/home) is a 2026 head-to-head points NBA league. Its public API lists 10 teams and 140 roster references; all 140 IDs match Fantrax's NBA player directory. The reduced [scoring fixture](../../__tests__/fixtures/fantrax-nba-points-scoring.json) contains only its six scoring categories, not team or account details. On 2026-10-31 the fixture's mode, category codes, positions, and weights matched a fresh `getLeagueInfo` response exactly.

The six imported rules are `pts: 1`, `reb: 1.25`, `ast: 1.5`, `stl: 2`, `blk: 2`, and `to: -1`. These are NBA's canonical stat keys and the NBA trade evaluator accepts them. A deterministic two-team points comparison using all six weights passes. This verifies the scoring translation and evaluator calculation; a live league trade grade remains unverified until the league is refreshed in a nonproduction environment and its unresolved player identities are reviewed. Other Fantrax NBA categories still produce named scoring gaps rather than guessed rules.

## Supplied league readiness, 2026-10-31

The read-only [league readiness audit](../../scripts/audits/fantrax-nba-league-readiness.cjs) checks the live Fantrax roster against each named database. The source league has 10 teams and 140 roster player IDs; Fantrax's NBA directory resolves all 140.

| Check | Staging | Production |
| --- | ---: | ---: |
| Connected Fantrax accounts | 0 | 1 |
| Stored snapshot for this source league | 0 | 1 |
| Imported league row through legacy snapshot ID | 0 | 1 |
| NBA identity rows in database | 1,856 | 1,868 |
| Roster IDs with a unique NBA identity | 132/140 | 133/140 |
| Matched IDs with a complete latest season stat row for all six rules | 132 | 133 |
| Regular-season NBA stat rows with games played | 1,053 | 2,740 |

The production import uses its legacy snapshot ID as `platformLeagueId`, so a lookup by the Fantrax source ID alone misses it. Seven production roster IDs have no unique NBA identity. The staging source sync below linked 132 IDs and left eight without a unique name match. Both audits made no database changes; the separate staging sync wrote the identities and stats shown in the staging column.

The [staging-only source sync](../../scripts/sync-fantrax-nba-trade-data.cjs) read the public Fantrax roster and Rolling Insights 2025 and 2026 NBA season feeds. It linked a Fantrax ID only when its normalized name uniquely matched an NBA identity whose stored Rolling Insights ID also carried that name in the provider feed. It wrote 1,053 complete season rows with games played; eight roster IDs were left unresolved. A second dry run found zero new links, showing the identity step is repeatable. It did not create a league or claim a team.

The [read-only smoke](../../scripts/audits/smoke-fantrax-nba-trade-grade.ts) passed through the actual NBA evaluator with one linked player from each of two public league teams and all six live scoring weights. It returned 2026 season values of 24.35 and 22.63 points per game, with no coverage warnings. This proves the data and scoring path for those players, not a user-authorized league trade request. The evaluator now also accepts Fantrax's `Last, First` display names when its exact player ID matches the identity map.

The public league ID is enough to discover the 10 teams and let a signed-in AllFantasy user select a team they control for import. A Fantrax Secret ID is optional for automatic ownership verification and should remain inside the app. The next end-to-end check is a staging import through that selection flow, followed by a trade-evaluator request involving linked players on two teams. Trades involving any of the eight unresolved players must continue to return an explicit coverage error.

Commands:

```text
node scripts/audits/nba-trade-coverage.cjs .env.staging
node scripts/audits/nba-trade-coverage.cjs .env --production-readonly
node scripts/audits/fantrax-nba-league-readiness.cjs .env.staging 51isdapqmt6atvdz
node scripts/audits/fantrax-nba-league-readiness.cjs .env 51isdapqmt6atvdz --production-readonly
node scripts/sync-fantrax-nba-trade-data.cjs 51isdapqmt6atvdz
node --env-file=.env.staging --require ./scripts/_audit-preload.cjs --import tsx scripts/audits/smoke-fantrax-nba-trade-grade.ts 51isdapqmt6atvdz
```
