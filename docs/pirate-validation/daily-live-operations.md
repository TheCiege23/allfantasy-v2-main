# Pirate NBA live daily pilot

Prepared on October 29, 2026 before actual game locks. `daily-live-staging.json` records the separate exact fixture, eight genuine provider players and four synthetic `example.invalid` owners. The user's PVT league and the NFL rehearsal are outside this pilot's scope.

## Observation window

- NBA 2026 week 2, October 27 through November 2, using the canonical Eastern-day window.
- Exact daily rows were first written October 29 for that day through November 2: 40 rows, eight players across four rosters. No earlier days were backfilled as lock evidence.
- First October 29 tipoff: October 30 at 00:00 UTC, **October 29 at 8 PM Eastern**. Last tipoff: October 30 at 02:00 UTC, **10 PM Eastern**.
- Cases: legal lineup control, empty starter with bench replacements, reserve activation witness plus bench, and a second empty-starter control. Actual player activity, injury changes and final losses determine any outcome. An actual late scratch is an observation still to be collected, not a fabricated test event.
- Setup and a local invocation of the exact guarded route verified 30 matched NBA lock teams, all 40 saved daily rows, independent full-week calendar agreement, canonical game-log ingestion and refused premature finalization (`games_not_final`). Before-lock capture count was correctly zero outside the seven-minute window.

## Runtime

Same isolated Railway project/environment as `live-rehearsal-operations.md`. The web must pin `PIRATE_DAILY_REHEARSAL_LEAGUE_ID=79e54743-2d88-430e-9770-5b62bd6dee82`. The `pilot=daily` selector cannot name an arbitrary league, requires a daily-tagged fixture tenant and an enabled NBA daily season, and verifies every owner is synthetic.

| Worker | Service ID | UTC cadence | Task |
| --- | --- | --- | --- |
| Daily capture | `1e17b7c4-e416-4d3c-8391-0943581341cc` | Every five minutes | `daily-capture`, independent from data latency |
| Daily data and score | `6f564e52-e9d9-4daf-9fcc-9a236305ec1f` | Every fifteen minutes, offset three minutes | `daily-data`, refresh then score only on success |

New workers use `scripts/railway-pirate-rehearsal.ts` on Bun, a same-project reference to `pirate-web.CRON_SECRET`, restart policy `NEVER`, 0.25 vCPU and 0.25 GB memory. Existing NFL workers retain their working configuration. The shared four-sport injury worker already supplies the fifteen-minute injury feed; this pilot does not duplicate it. All workers expire November 7 at 12:00 UTC.

The daily data task uses the canonical ESPN scoreboard writer for every day of the full matchup week. It compares the entire slate against the independent RI schedule, including team identities and exact start times. Partial responses, duplicate games or disagreement prevent certification. Only dates whose games have begun are requested from the canonical RI game-log importer; a 304 after play starts remains unknown. The last two played dates are refreshed each tick. Unstarted dates are not claimed to have empty final boxes. Scoring additionally requires the latest data heartbeat to be successful and no older than thirty minutes. The canonical finalizer still enforces actual completed games, coverage and grace.

## Bugs found by live preparation

ESPN labels NBA/NHL by the ending year, while native redraft uses the starting year. The scoreboard now normalizes that year on ingestion. Cached UI abbreviations stay intact; original ESPN full names are retained in the game's raw metadata, and the weekly slate reader uses those names for NBA/NHL locks. The observed NBA `LA Clippers` / `Los Angeles Clippers` alias is normalized in the shared lock identity helper. Other sports retain their existing ingestion behavior.

Staging's NBA profiles and missing provider identity links were refreshed through the existing canonical services. No direct provider HTTP, fabricated player statuses, results, game times, or penalty evidence were added by the fixture.

## Acceptance and release

Inspect actual immutable before/after records at real tips, deduplication, saved Eastern dates, fresh injury coverage, late-scratch handling and retained protections for unverified cases. Complete the real weekly result and actual 24-hour claim deadline separately. Physical Android rules/push checks and production sign-off remain release gates. Disable both new schedules during cleanup alongside the three NFL workers; expiry stops work but not scheduled bootups. Remove only the exact synthetic fixture and its owned accounts after evidence is retained. Provider data remains shared canonical staging data.
