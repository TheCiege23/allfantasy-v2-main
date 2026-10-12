# League readiness: five areas

## Delivered

1. **Schedule:** the Big Brother Schedule tab reads the actual cycle, displays HOH, nominations, veto draw/decision, conditional replacement, voting and eviction dates, supports completed-cycle history and uses the viewer's timezone. Missing configuration stays visibly unset. The API uses canonical membership and private, uncached responses.
2. **Complete cycles:** real PostgreSQL integration tests run six-houseguest NFL and NCAAF seasons through HOH, nominations, veto save/pass, replacement, voting, concurrent eviction, roster archival/release, jury enrollment and a published final-two winner. Final-three, incomplete/tied jury ballots, HOH contingency ballots and commissioner tie resolution have separate tests. Published finale and eviction results are idempotent.
3. **Scoring:** incomplete/missing starter stats remain active; challenges require complete finalized scores in score mode. Corrections reuse the completed week's recorded lineup, update totals and standings, and issue one revision notice without changing the published eviction/winner. Native schedules use stored redraft matchups when available. Imports retain platform-owned records.
4. **Automation/reminders:** one shared deadline resolver uses the settings convention Monday=1 through Sunday=7 (0 unset), anchors dates to the cycle and respects explicit vote extensions. Overdue work is caught after midnight. Pauses are honored. Reminder IDs prevent duplicate sends, including concurrent sweeps. A GitHub Actions job requests authenticated sweeps every 15 minutes after the deployed build advertises the repaired engine capability. Each sweep advances one phase, preserving a manager opportunity between phases.
5. **Other standings:** the shared view displays actual native points, IDP, category and roto records plus imported platform totals. It supports season selection, team search, viewer highlighting, cumulative Best Ball columns, refresh/retry and mobile table scrolling. No completed results means an empty state; missing imported category totals and ranks remain unknown.

## Evidence

- 248 release tests passed across 14 files, followed by 166/166 tests including the final commissioner nominee control (249 distinct passing tests). The isolated database suite passed 7/7. The release CI reruns the full suite and the isolated database tests.
- Database safety: the integration suite requires an explicit opt-in, loopback host and the database named `readiness`; it creates/deletes only its generated fixture IDs. No live league is used for writes.
- Focused TypeScript compilation: no diagnostics in changed files; existing diagnostics are in the decision world and Guillotine event-log modules. CI's existing TypeScript ratchet remains the merge gate.
- `git diff --check` passed.

## Operational details

- Reminders appear in league chat. This change does not establish email or mobile push delivery.
- GitHub scheduled starts can be delayed. The overdue resolver catches missed runs; a 15-minute schedule is not an exact-deadline guarantee.
- Incomplete or tied jury ballots remain pending; no arbitrary winner is selected. A commissioner can extend unresolved eviction voting or resolve a tie only when the configured rule permits commissioner choice.
- Hybrid/AI-theme challenge modes retain their configured seeded-random behavior; deterministic score mode never substitutes a random winner for missing scores.
- Imported historical standings require that season's source data. Current records are not relabeled as an older season.
- Blah remains an unplayed league. Its missing dates and results require commissioner setup and actual finalized games; the release does not fabricate them.
- No production schema change is required. Pause progression in the Commissioner Hub to stop a league; disabling the Big Brother deadlines workflow stops scheduled sweeps.

## Research informing correction behavior

- Sleeper, [Stat Corrections](https://support.sleeper.com/en/articles/2441282-stat-corrections): published weekly reports can receive later provider corrections.
- Sleeper, [Recalculate Matchup Records](https://support.sleeper.com/en/articles/12076832-recalculate-matchup-records): recalculation is needed after relevant scoring/lineup changes.
- CBS, [Big Brother official episodes](https://www.cbs.com/shows/big_brother/episodes/26/): challenge, nomination, veto, eviction, jury and finale stages inform the timeline; league configuration controls application rules.
