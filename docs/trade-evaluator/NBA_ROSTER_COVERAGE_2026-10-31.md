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

The live Fantrax import now preserves the documented `scoringSystem.type` and selects among CFB, NFL, and NBA player directories. It does not invent NBA scoring-rule translations when the provider supplies category codes this codebase has not mapped. A real NBA points-league `scoringCategorySettings` fixture is needed to add and verify those translations.

Commands:

```text
node scripts/audits/nba-trade-coverage.cjs .env.staging
node scripts/audits/nba-trade-coverage.cjs .env --production-readonly
```
