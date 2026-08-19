# G36 NFL Redraft Schedule Engine

## Scope

G36 completes the deterministic schedule runtime for AF NFL redraft leagues. It does not build external Decision OS, Commissioner OS, Manager OS, or live scoring consumers. Those systems can subscribe later through canonical runtime events.

## Runtime Contract

- Uses canonical league rules from G33 for schedule length, playoff transition, playoff team count, and tiebreaker labels.
- Uses G35 roster runtime readiness before opening or advancing regular season weeks.
- Generates head-to-head weekly matchups from the redraft roster list only.
- Supports odd team counts through deterministic bye rows.
- Prioritizes division matchups when league division assignments are present.
- Protects regeneration once the schedule has locked, scored, or prior-week rows unless a commissioner override is explicit.
- Recalculates standings only from finalized or completed matchup scores.
- Prepares playoff qualification snapshots without creating playoff bracket runtime.

## Canonical Events

The runtime normalizes these events for future consumers:

- `schedule.generated`
- `schedule.regenerated`
- `schedule.locked`
- `schedule.week.opened`
- `schedule.week.completed`
- `matchup.created`
- `schedule.bye.assigned`
- `division.assigned`
- `standings.recalculated`
- `playoffs.qualification_snapshot.updated`
- `commissioner.schedule_override`

## Surfaces

- `GET /api/redraft/schedule` returns the authenticated schedule runtime view by `seasonId` or `leagueId`.
- `POST /api/redraft/schedule` supports commissioner-scoped generation, regeneration, week open/complete/advance, schedule lock, and standings recalculation.
- The redraft league tab now shows a deterministic schedule panel with weekly matchups, bye indicators, schedule health, and playoff qualification prep.

## Data Rules

- No fabricated scores, standings, projections, confidence, or live results.
- Standings are initialized at 0-0 and move only when `RedraftMatchup.status` is `final` or `completed`.
- Bye weeks never count as wins.
- Playoff qualification prep is a seed snapshot only; bracket generation remains in the existing playoff flow.

## Remaining Gaps

- Live NFL scoring remains downstream of cached weekly stat sync.
- Division editing UI is not expanded in G36; the runtime consumes existing `LeagueTeam.divisionId` assignments when available.
- Browser proof depends on an authenticated NFL redraft fixture with a generated schedule.
