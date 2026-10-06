# Team speed and exact alert targeting — 2026-10-06

## Behavior

My Team overlaps independent claimed-team/team-count and projection-week/sports-week reads. The private alert endpoint uses a saved-roster evaluation path that retains player identity, injury, eligibility, projections, byes and kickoff evidence, while omitting market, weather, grades, dynasty, transactions and matchup enrichment. It does not relax evidence freshness or fetch a live provider roster. The second injury-status evidence lookup receives only affected identities; deadline-only alerts skip it.

Injury links carry the league, affected player, original starting slot and original kickoff. The review page checks these against the current authorized roster before selecting the starting slot, leaving the backup unselected. Changed lineups, status, schedule, expired alerts and automatic scoring receive explanatory states. Deadline links identify the recorded calendar event and original timestamp, distinguishing current, changed, removed and expired records. Valid query context focuses the review panel even when sign-in drops the URL fragment. Routine roster refreshes do not repeat the scroll.

Opening either link is read-only. Existing membership checks, private no-store API responses, alert deduplication, delivery claims, channel preferences and lineup-save guards remain in force. No schema, migration, index, cron or provider-write changes.

## Validation

- Controlled saved-roster test fixture: full loader **15 mocked database reads**, alert evaluation **11** (4 fewer, about 27%). This measures only that fixture's query count, not production response time or browser loading speed. Evidence fields and bench players compare equal.
- Independent-read concurrency and no live-roster request verified.
- Focused final suite: **24 tests passed** across targeting, English/Spanish panels, loader budget, affected-only evidence reads and private route access.
- Existing Team desktop/mobile/tablet regression suite: **74 tests passed** before the final focus/copy refinements; the focused suite covers those refinements.
- Authenticated local Chromium/WebKit browser acceptance for PC, iPhone, Android and tablet: in progress at PR creation.
- Existing exact-navigation policy assertions and Spanish source-coverage checks: **31 tests passed** (includes targeting tests).
- Browser acceptance caught millisecond loss when comparing hydrated Date values; the fix uses exact epoch timestamps and has a fractional-second regression test.
- Required remote CI and production release verification: pending. Initial CI identified the same Date typing issue, a generic-link assertion needing the new destination, and Spanish coverage for the alert-only reason. These were fixed without changing CI baselines.
- Physical-device and signed-in production acceptance remains pending user-guided checks; local emulation is not a physical-device result.

## Follow-up measurement

Measure production p50/p95 response time separately for My Team and team-alerts under representative roster sizes and existing sync conditions. Compare query counts, slow queries and enrichment timings before making any latency claim. Preserve user/league scoping and evidence freshness when considering further caching.
