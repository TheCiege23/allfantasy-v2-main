# Zombie staging player data quality
Scope: NFL, NBA, NHL, MLB. Existing user leagues and drafts remain unstarted.

## Read paths
- Redraft pools filter historical profiles before limiting results; dynasty and college pools retain their existing scope.
- Fresh current roster evidence can retain injured RI players. INACT alone cannot prove retirement.
- Photos and position supplements require a unique verified identity; conflicting birthdays fail closed. RI scoring IDs are preserved.
- Season box scores join sport + RI player ID. No per-player provider calls occur on a draft read.
- Current-season games take precedence; previous-season fallbacks display their actual season.
- NHL goalie decisions and shutouts are omitted from this new read path while the documented provider backfill remains unverified.

## Maintenance
- Existing import-schedules accepts rosters=1&rosterSports=SPORT for a bounded, isolated roster sweep.
- Existing import-players accepts sleeperRows=1&sport=NFL for a bounded upsert-only NFL roster refresh.
- Repeated NFL refreshes skip rows already refreshed within 24 hours so new identities can be imported.
- Existing import-season-stats?tsdb=0 imports contracted NFL stats; import-stat-lines imports contracted RI NBA/NHL/MLB stats.
- Missing provider photos remain honest placeholders and are not counted as photo coverage.

## Acceptance
Audit all four saved pools after roster, stat and image ingestion. Measure real photo URL coverage separately from successful image rendering.
Run identity, season-selection, stat-unit tests, type checking and the existing desktop/mobile draft suites.
No production database changes or league-state transitions are part of this pass.

NBA season minutes and NHL season time on ice use the measured seconds contract from lib/chimmy/tools/dailySportStats.ts; the direct RI draft reader converts them to minutes before generic rate extraction. MLB two-way primary positions remain TWP.

A secondary position may replace a primary position only when the verified athlete is also assigned to the same current club. Photos may still match across a transfer using the athlete identity; an older club or role is not copied into the current roster.
