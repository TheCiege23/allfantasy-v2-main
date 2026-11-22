# Player Finder next steps: implementation and release gates

**Started:** 2026-11-03. **Base:** `d7e2a1bbec` on `origin/main`. This worktree is isolated from the dirty `G:\allfantasy-v2-main` checkout. Production queries below were SELECT-only. The per-ID CSV snapshots are saved locally in `G:\allfantasy-v2-main\docs` for review and are not included in the code change; rerun `scripts/sql/player_finder_identity_exceptions_readonly.sql` before linking or releasing.

## 1. Identity exceptions classified

| Cohort | Verified | Exception classes |
| --- | ---: | --- |
| Sleeper NBA roster IDs | 233 / 595 | 268 source rows have a team but no exact name/position/team identity; 54 source rows have no team; 40 roster IDs have no Sleeper `SportsPlayer` row. Total unresolved: 362. |
| Fantrax NCAAF roster IDs | 3,293 / 4,964 after one verified link | The initial export held 1,662 names/positions without a team and 10 missing metadata rows. The linked record had independent current Fantrax and CFBD school evidence; 1,671 exceptions remain. Name/position alone still cannot authorize a link. |

Local review files: `G:\allfantasy-v2-main\docs\player-finder-nba-roster-exceptions-2026-11-03.csv` (362 rows) and `G:\allfantasy-v2-main\docs\player-finder-ncaaf-roster-exceptions-2026-11-03.csv` (1,671 rows after the verified link). The report query is read-only and includes linked rows when run without the export filter. A non-null NBA team or a unique NCAAF name is not proof of identity. The 523-row NBA figure in the earlier plan excluded 54 teamless Sleeper rows; all 577 source rows are now the denominator.

The first claimed NCAAF roster was at 37/39 (94.9%) before review. Its current 2026 Fantrax snapshot contains `05yzi` as Tayven Jackson, QB, school `NorTx`; the sole canonical QB identity with that name has CFBD athlete `4801307` at University of North Texas, five 2026 passing game lines, and no competing CFBD or Fantrax owner. A conditional production update linked only that ID. The other unresolved roster ID, `068rx`, has multiple same-name WR identities and remains unlinked. The roster is now 38/39 (97.4%); all Fantrax NCAAF rosters are 3,293/4,964 linked. The production exception CSV was refreshed after the update. The other 1,671 unlinked IDs need evidence beyond the imported name/position before linking.

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

Current main already contains an idempotent, bounded NBA Sleeper row refresh in `refreshSleeperPlayerRows` and the `import-players` cron. This change adds a separate reconciliation pass immediately after a successful refresh, including the dedicated `?sleeperRows=1&sport=NBA` path. It reads NBA source rows and identity rows in one batch and requires a unique team match plus either exact name/position, a spelling alias with matching birthday/position, or exact name/birthday when two providers label the same basketball player at different positions. Known conflicting birthdays are refused. The conditional `sleeperNbaId IS NULL` update uses the existing unique `(sport, sleeperNbaId)` index. Duplicates and missing evidence stay unlinked. The cron reports scanned, proposed, linked, remaining, error, and reason counts. No delete/recreate path is used. Read-only production review found 29 unique unresolved name/birthday matches with differing basketball positions; all require the team check before the cron can link them.

## 4. Period advice pilot and coverage gates

The new Finder loader reads `player_game_stats`, the league scoring rules, the canonical identity map, and stored schedules. It requires three usable same-season game lines, at least one stat key that the league scores, and a future fixture. NCAAF uses CFBD athlete IDs and the CFBD weekly schedule. Its stored `normalized_stat_map` still has CFBD box keys such as `passing.YDS`, so the pilot translates only measured athlete box fields into the scorer's keys; team-defense and unverified forced-fumble fields remain absent. A CFBD ID held by more than one identity is refused (12 duplicated IDs existed at audit time). NCAAB uses its recorded 2026-11-01 opener and the stored Rolling Insights week window. Production RI NCAAB and soccer game maps store numbers under `stats`; NCAAB uses the existing measured box normalizer, while soccer maps measured goals, assists, cards, saves, penalty saves, and position-specific clean sheets. Unmeasured own-goal and missed-penalty fields are excluded. Soccer uses a verified EPL/LaLiga/Serie A competition code and competition-tagged RI fixtures. Category leagues, missing identities, unsynced schedules, and insufficient form yield unavailable instead of a fabricated point estimate.

Current release status by sport:

- NCAAF: after the single verified link, 12 of 152 Fantrax rosters meet the 95% identity gate and one is claimed. The pilot roster is 38/39 (97.4%); all ten starters have at least five 2026 CFBD lines with offensive fields. Nine starters have a future week-10 fixture (Kent State is on a bye), meeting the plan's 90% scheduled-starter coverage gate. Period advice is now restricted to an explicit comma-separated `PLAYER_FINDER_PERIOD_PILOT_LEAGUE_IDS` server environment allowlist, empty by default. Configure only league `ff59b139-03a8-47c6-82c0-59d6580670b4` after review and deployment, then verify one owned-player Finder request and one legal bench-swap/pickup end to end before expanding.
- NCAAB: one manual points league has 20 rosters but no imported `playerData.players`; the current RI 2026 season schedule cache must be verified before advice. Daily lineup scoring remains unsupported for NCAAB, so this implementation is weekly only. Pickup suggestions remain disabled until roster and participation coverage is verified.
- Soccer: ten ADP seed leagues have zero rosters. Production `SportsGame` has only ten fixtures over the next 14 days from TheSportsDB; RI schedule cache must be synced with all three competitions and tagged fixtures before a scoped pilot. An unscoped soccer league is unavailable. Pickup suggestions remain disabled until roster and participation coverage is verified.

Do not widen the cohort until a claimed league passes the plan's 95% identity gate, the period's schedule is complete, and a sampled lineup/pickup is verified end to end. An unresolved roster ID never gets another player's game log, and a missing fixture is never a zero-point forecast.

## Validation

Focused Vitest suite: 17 tests passed across NBA reconciliation, CFBD box normalization, college/soccer outlook gates, the existing Finder impact path, and pilot allowlist. Focused TypeScript project: zero errors in changed modules; 41 errors remain in unrelated imported modules. The repository-wide typecheck exceeded Node's 8 GB heap limit. Validation dependencies and Prisma Client were installed/generated in a temporary C: copy because G: lacked space; no test connected to production.

## Follow-through audit, 2026-11-03

### Live search and NBA reconciliation

The public `/api/players/search` and `/players/{slug}` paths returned matching results and HTTP 200 detail pages for NBA, NHL, MLB, NCAAF, NCAAB, and soccer. This is a signed-out catalog check; a signed-in roster chip still needs a browser session to verify its display.

After PR #3208 was deployed, the existing authenticated `?sleeperRows=1&sport=NBA` path ran in three bounded batches. It created 1,599 missing Sleeper source rows and linked 31 identities with zero reconciliation errors. All 595 distinct Sleeper NBA roster IDs now have a source row; 264 are identity-linked. The remaining 331 are 94 teamless source rows and 237 team-bearing rows without independent matching evidence. The route's `remaining` value is per-run feed coverage, not a cumulative backlog: a fresh existing row is counted as remaining even after the whole feed is stored. Use the distinct source-row count and roster exception query for the release check.

### NCAAF pilot validation

The claimed Fantrax league `ff59b139-03a8-47c6-82c0-59d6580670b4` has 38/39 mapped roster IDs and ten mapped starters. A read-only production-data run of the actual Finder impact loader, with the allowlist simulated locally, exposed two gaps: the verified Coastal Carolina RB Dominic Knicely is now listed by the school and CFBD as Dominic Lee-Knicely, and Fantrax stores `SLOT:COUNT` roster positions whose order does not correspond to the starters array. This branch adds only that independently verified name alias and proves counted-lineup swaps by matching the entire lineup to all allowed seats. It does not infer a player's exact seat from array order.

With those local fixes, the read-only run produced an impact for all ten starters, priced nine with upcoming fixtures, and left Kent State's Wayne Harris unavailable on a bye. It found a legal bench upgrade: Beau Sparks over Preston Douglas, +7.96 projected league points. The server allowlist remains unset in production until this branch is reviewed and deployed; then enable only this league and verify an authenticated Finder card in the browser.

The reusable read-only check is `scripts/verify-player-finder-period-pilot.ts`; run it with the repository's `scripts/_audit-preload.cjs` shim and `--preview-allowlist --all` for a full claimed-roster report. Focused Vitest validation passed 20 tests across four files. Focused TypeScript validation found zero diagnostics in the changed modules or pilot script; 41 diagnostics remain in imported modules outside this change.

### NCAAB and soccer coverage

The 2026 NCAAB Rolling Insights schedule cache is synced (2026-11-03) and contains 598 games over the next 15 days, but the only production NCAAB league has 20 empty rosters. Current-season game logs contain 2,551 players with one line each, below the loader's three-game minimum. No user roster or forecast should be synthesized from the catalog.

The soccer cache has 33 upcoming fixtures over three days, all without competition tags. A scoped production schedule refresh was refused by the existing completeness guard because the provider did not return three complete 380-game league slates; no cache was overwritten. The ten soccer seed leagues have no rosters or verified competition settings. Keep soccer advice unavailable until the provider supplies a complete tagged schedule and a real claimed league exists.

### Identity exceptions and schema ownership

The read-only Fantrax NCAAF exception query now finds 3,295 linked of 4,968 roster IDs. The remaining 1,673 are 750 unique name/position candidates without an independent team or provider-ID proof, 624 with no exact candidate, 289 ambiguous candidates, and 10 missing metadata. No additional identity was linked from name alone. The two earlier local CSV exports predate this refresh and are not release evidence; rerun the query before reviewing a specific ID.

Production's `redraft_player_state_events` writer is the enabled `redraft_player_state_capture` trigger on `redraft_roster_players`, implemented by `capture_redraft_player_state()` and owned by `neondb_owner`. It was still writing during this audit (207,636 events across 543 leagues); `redraft_lineup_history_epochs` held 569 rows. Both tables and their `ON DELETE CASCADE` league foreign keys are one operational history unit. `sports_stat_coverage` is empty and has no repo reader or writer, but emptiness is not deletion evidence. Preserve all three tables. The seven dated repair/rollback tables also remain preservation evidence; assign no deletion date.

The repo's read-only production drift check found exactly 12 new destructive clauses relative to its 2026-09-13 baseline: ten live tables and the two history foreign keys. Two old draft-session index clauses were resolved. The generated production baseline now records the exact 238-clause diff for endpoint `ep-curly-block-ad0dlt9o/neondb`; this is an explicit preservation baseline, not SQL to apply. Neon production retains 24 hours of branch history. Before any future retirement of these objects, assign a retention owner, take a named snapshot, restore it to an isolated branch, and verify row counts, foreign keys, and the trigger there. No production schema object was changed here.
