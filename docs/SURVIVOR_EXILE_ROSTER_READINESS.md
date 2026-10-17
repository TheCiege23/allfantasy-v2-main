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

October 12 continuation: the scheduled NBA/NHL player-score ingestion now includes separate Exile roster snapshots and the common slate finalizer counts closed Exile starters. Exile results still refuse missing/unfinalized rows; an absent Exile starter row now yields `exile_stat_missing`, never a fabricated zero. The planned-season runner consumes the saved NBA/NHL week plan, skips no-elimination weeks, uses the configured Eastern Torch Ceremony day/time, settles the one Exile return spot from the deadline snapshot, and preserves three finalists if nobody qualifies. The runner uses the existing score-sync cron slot. Island, Exile, immunity, idol, ceremony, merge, jury and champion surfaces now use the supplied SVG artwork; published result share cards render live data into downloadable PNGs rather than reusing example screenshots.

This is still **not** a complete unattended hosting release. The scheduled planned-season runner is kept behind `SURVIVOR_PLANNED_SEASON_AUTOMATION_ENABLED=true` and must remain off in production until the release gates below pass. The remaining gates are a persisted end-to-end season replay with real NBA/NHL score windows, corrections, Exile return and finale; deterministic system handling for a tied or empty Elimination Council under the configured tie rules; verified sport-specific challenge scoring and rewards (the current generic challenge tally writes a placeholder result); and a correction policy for stats received after the common redraft week seals. The runner deliberately leaves unresolved votes and missing scores pending instead of inventing an elimination or score.

Exile free pickups currently settle atomically in arrival order. A separate Exile FAAB/waiver-priority policy and roster template are future commissioner settings; the main league's bid queue does not run this separate pool.

Next milestone: finish the real persisted replay and the tie/challenge engines before marketing NBA/NHL Survivor as autonomous full-season hosting. The current unit replay covers all planned periods with and without a qualifying Exile return; focused service tests cover Exile-only score ingestion, DST ceremony timing, unresolved councils and pre-reveal share privacy.

Research basis for the next scoring milestone: Sleeper documents that weekly reports do not make scores final and late corrections can change results: https://support.sleeper.com/en/articles/2441282-stat-corrections. AllFantasy must resolve those corrections deterministically before irreversible specialty-league outcomes.
