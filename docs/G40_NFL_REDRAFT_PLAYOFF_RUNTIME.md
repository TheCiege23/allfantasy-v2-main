# G40 NFL Redraft Playoff Runtime

G40 completes the canonical NFL redraft playoff runtime without building Decision OS, Commissioner OS, or Manager OS consumers.

## Runtime Scope

- Deterministic playoff qualification from redraft roster standings.
- Configurable playoff team count, playoff start week, first-round byes, reseeding, and consolation bracket support from canonical league rules.
- Bracket generation for standard power-of-two championship brackets, including 4-team, 6-team, 8-team, and odd-size formats that require byes.
- Round advancement from stored scores or explicit winners.
- Tie handling by seed when both seeds are available; unresolved ties remain blocked for commissioner resolution.
- Champion crowning, runner-up capture, and final standings calculation after the championship round is complete.
- Best-effort canonical `LeagueEvent` writes for downstream league history and future OS consumers.

## Canonical Events

The runtime emits the playoff vocabulary needed by platform consumers:

- `playoffs.qualification.calculated`
- `playoffs.seeds.updated`
- `playoffs.bracket.generated`
- `playoffs.bracket.locked`
- `playoffs.round.opened`
- `playoffs.matchup.created`
- `playoffs.advancement`
- `playoffs.team.advanced`
- `playoffs.team.eliminated`
- `playoffs.reseeded`
- `playoffs.consolation.generated`
- `playoffs.championship.matchup.created`
- `playoffs.champion.crowned`
- `playoffs.final_standings.recorded`
- `season.completed`
- `commissioner.playoff_override`

Legacy underscore aliases normalize into the canonical dotted event names.

## API Surface

- `GET /api/redraft/playoff-runtime`
  - Requires league membership.
  - Accepts `seasonId` or `leagueId`, plus optional `week`.
  - Returns the canonical playoff runtime state and commissioner flag.

- `POST /api/redraft/playoff-runtime`
  - Requires commissioner access.
  - Supports `generate_bracket`, `regenerate_bracket`, `advance_round`, `finalize_season`, and `commissioner_override`.

- Existing public routes now delegate to the canonical runtime:
  - `POST /api/redraft/playoffs/generate`
  - `POST /api/redraft/playoffs/advance`
  - `POST /api/redraft/seasons/finalize`

## UI Surface

The redraft standings tab now reads the runtime snapshot and shows:

- Playoff settings summary.
- Qualified seeds.
- First-round byes.
- Stored bracket rounds and matchups.
- Champion banner and final standings after crowning.
- A deterministic empty state when standings exist but no bracket has been generated.

## Non-Goals

- No Decision OS or intelligence consumer was added.
- No fake projections, confidence, recommendations, or live data were created.
- No college football playoff runtime was built in this slice.
- No broad theme, route, or league-shell refactor was included.

## Verification Notes

Focused G40 verification covers pure runtime qualification, bracket generation, advancement, reseeding, champion crowning, event normalization, and a Playwright browser harness. Authenticated production-data browser coverage remains dependent on existing seeded E2E league fixtures; the committed G40 browser proof uses deterministic in-repo runtime data rather than fabricated production data.
