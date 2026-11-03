# Player Finder next steps: implementation and release gates

**Started:** 2026-11-03. **Base:** `d7e2a1bbec` on `origin/main`. This worktree is isolated from the dirty `G:\allfantasy-v2-main` checkout. Production queries below were SELECT-only. The per-ID CSV snapshots are saved locally in `G:\allfantasy-v2-main\docs` for review and are not included in the code change; rerun `scripts/sql/player_finder_identity_exceptions_readonly.sql` before linking or releasing.

## 1. Identity exceptions classified

| Cohort | Verified | Exception classes |
| --- | ---: | --- |
| Sleeper NBA roster IDs | 233 / 595 | 268 source rows have a team but no exact name/position/team identity; 54 source rows have no team; 40 roster IDs have no Sleeper `SportsPlayer` row. Total unresolved: 362. |
| Fantrax NCAAF roster IDs | 3,292 / 4,964 | 1,662 have a name and position in imported metadata but no team; 10 have no metadata. Among the 1,662, reversing Fantrax's `Last, First` name gives 751 unique name/position identity candidates, 289 ambiguous candidate sets, and 622 without a candidate. None is safe to auto-link from that evidence alone. |

Local review files: `G:\allfantasy-v2-main\docs\player-finder-nba-roster-exceptions-2026-11-03.csv` (362 rows) and `G:\allfantasy-v2-main\docs\player-finder-ncaaf-roster-exceptions-2026-11-03.csv` (1,672 rows). The report query is read-only and includes linked rows when run without the export filter. A non-null NBA team or a unique NCAAF name is not proof of identity. The 523-row NBA figure in the earlier plan excluded 54 teamless Sleeper rows; all 577 source rows are now the denominator.

## 2. Schema drift disposition

The current production difference remains ten live tables and two foreign keys. This is a **preservation decision**, not a request to apply Prisma's destructive full diff.

| Object group | Evidence | Disposition and gate |
| --- | --- | --- |
| `_rfix_20261027_*` (3 tables) | 23 map rows, 23 roster-player preimages, 4 roster preimages. | Keep as one repair audit set. Classify retention and backup owner before any retirement. |
| `af_league_type_week_20261026`, `af_nba_playoff_week_20261025`, `af_playoff_backfill_20261023`, `af_trade_deadline_default_20261027` | 4, 10, 19, 9 rows respectively. The trade-deadline undo SQL reads its preimage. | Keep as rollback evidence. Do not drop or reset without a separate retention review and restore rehearsal. |
| `redraft_lineup_history_epochs` + `redraft_player_state_events` and their two `leagueId` FKs | 565 and 201,693 rows; latest recorded event timestamp 2026-11-03 13:40 UTC. | Treat as active operational history. Preserve both tables and both `ON DELETE CASCADE` FKs together. Add Prisma models only if a repo writer/reader needs them; otherwise baseline them as explicitly external after writer ownership is recorded. |
| `sports_stat_coverage` | 0 rows. | Keep pending writer/reader ownership check; empty does not prove unused. |

No table, FK, or drift baseline was changed in production. The remaining PF-8 action is to identify the current writer and retention owner, capture a backup/restore path, then make a reviewed baseline or schema-model change against the exact production diff. The existing `scripts/check-schema-drift.ts` baseline is target-specific; do not append guessed SQL strings.

## 3. NBA refresh and reconciliation

Current main already contains an idempotent, bounded NBA Sleeper row refresh in `refreshSleeperPlayerRows` and the `import-players` cron. This change adds a separate reconciliation pass immediately after a successful refresh, including the dedicated `?sleeperRows=1&sport=NBA` path. It reads NBA source rows and identity rows in one batch, proposes only a unique name/position/team match or a spelling alias supported by matching birthday, position, and team, then writes with a conditional `sleeperNbaId IS NULL` update under the existing unique `(sport, sleeperNbaId)` index. Duplicates and missing evidence stay unlinked. The cron reports scanned, proposed, linked, remaining, error, and reason counts. No delete/recreate path is used.

## 4. Period advice pilot and coverage gates

The new Finder loader reads `player_game_stats`, the league scoring rules, the canonical identity map, and stored schedules. It requires three usable same-season game lines, at least one stat key that the league scores, and a future fixture. NCAAF uses CFBD athlete IDs and the CFBD weekly schedule. Its stored `normalized_stat_map` still has CFBD box keys such as `passing.YDS`, so the pilot translates only measured athlete box fields into the scorer's keys; team-defense and unverified forced-fumble fields remain absent. A CFBD ID held by more than one identity is refused (12 duplicated IDs existed at audit time). NCAAB uses its recorded 2026-11-01 opener and the stored Rolling Insights week window. Production RI NCAAB and soccer game maps store numbers under `stats`; NCAAB uses the existing measured box normalizer, while soccer maps measured goals, assists, cards, saves, penalty saves, and position-specific clean sheets. Unmeasured own-goal and missed-penalty fields are excluded. Soccer uses a verified EPL/LaLiga/Serie A competition code and competition-tagged RI fixtures. Category leagues, missing identities, unsynced schedules, and insufficient form yield unavailable instead of a fabricated point estimate.

Current production release gates are **not met** for a user-facing cohort:

- NCAAF: 11 of 152 Fantrax rosters individually exceed 95% identity resolution, but zero of those 11 is a claimed team. The full imported cohort is 66.3% resolved. An authenticated pilot requires a claimed, verified roster or a purpose-built staging league.
- NCAAB: one manual points league has 20 rosters but no imported `playerData.players`; the current RI 2026 season schedule cache must be verified before advice. Daily lineup scoring remains unsupported for NCAAB, so this implementation is weekly only. Pickup suggestions remain disabled until roster and participation coverage is verified.
- Soccer: ten ADP seed leagues have zero rosters. Production `SportsGame` has only ten fixtures over the next 14 days from TheSportsDB; RI schedule cache must be synced with all three competitions and tagged fixtures before a scoped pilot. An unscoped soccer league is unavailable. Pickup suggestions remain disabled until roster and participation coverage is verified.

Do not widen the cohort until a claimed league passes the plan's 95% identity gate, the period's schedule is complete, and a sampled lineup/pickup is verified end to end. An unresolved roster ID never gets another player's game log, and a missing fixture is never a zero-point forecast.

## Validation

Focused Vitest suite: 12 tests passed across NBA reconciliation, CFBD box normalization, and college/soccer outlook gates. Focused TypeScript project: zero errors in changed modules; 41 errors remain in unrelated imported modules. The repository-wide typecheck exceeded Node's 8 GB heap limit. Validation dependencies and Prisma Client were installed/generated in a temporary C: copy because G: lacked space; no test connected to production.
