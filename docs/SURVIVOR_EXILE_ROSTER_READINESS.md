# Survivor tribe assets and Exile roster release

Implemented October 12, 2026:

- Supplied catalogue: 50 named tribes with seven sport-specific crest sets. Creation and settings save distinct identities and exact manager capacities; assignment honors those capacities.
- Tribe setup locks at the live draft or actual tribe assignment. Playing commissioners can edit general setup without receiving hidden game information.
- Supplied Exile coin and parchment assets use actual token balances and published council results. No fabricated caps, boss resets, or immediate-return promise.
- Native Exile has its own weekly waiver roster and no draft. NFL QB, NBA PG, and NHL G reserve one real-world team. Other managers cannot take that team; teammates are claimed individually.
- Dropping an anchor releases the whole roster. Rosters use the league's eligible slots/capacities and lock at the team's first verified game. Reservations and claims serialize under the existing league transaction lock.
- Calendar rollover releases weekly rights independently of delayed scoring, preserving an immutable lineup envelope for scoring. NBA/NHL use the shared verified season windows and Eastern midnight with DST conversion.
- The Exile job folded into the existing hourly waiver heartbeat retries scoring only from final, covered player-week records. A missing result stays pending. A real final score of zero is accepted. Token settlement remains idempotent and uses the configured return deadline.
- No schema migration, production fixtures, or vendor probes are required.

Validation: focused UI/API/rule tests; isolated test-database concurrency, sport isolation, game lock, reset, and final-zero tests for NFL/NBA/NHL; desktop and 390px browser component checks.

## Remaining release gates for unattended full-season hosting

This change does not establish full-season readiness. The current score ingestion/finalization pipeline scans main-island redraft rosters. The separate Exile lineup must also be included in verified ingestion, identity mapping, coverage and stat-correction processing; otherwise Exile results correctly remain pending. Do not infer zero from an absent score row.

The broader Survivor automation route is not newly enabled by this release. Its week progression must consume the saved NBA/NHL season plan, including no-elimination weeks, merge, scheduled Exile return and finale. Add an accelerated persisted season replay before enabling it for unattended leagues.

Exile free pickups currently settle atomically in arrival order. A separate Exile FAAB/waiver-priority policy and roster template are future commissioner settings; the main league's bid queue does not run this separate pool.

Next milestone: ingest and finalize Exile score snapshots, then replay an NBA and NHL season through ties, missing stats, late corrections, elimination, return qualification, no qualifier, merge and finale with a playing commissioner receiving no hidden information.

Research basis for the next scoring milestone: Sleeper documents that weekly reports do not make scores final and late corrections can change results: https://support.sleeper.com/en/articles/2441282-stat-corrections. AllFantasy must resolve those corrections deterministically before irreversible specialty-league outcomes.
