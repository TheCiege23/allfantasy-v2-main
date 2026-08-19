# G47B NFL Redraft Live Stats, Scoring Refresh, and Stat Corrections

## Scope

G47B adds the canonical live stat and scoring refresh layer for the AF NFL Redraft League. It does not call real providers, build Decision OS, add AI reasoning, or redesign the redraft runtime.

## Canonical Data Flow

Provider payloads must be normalized before they reach runtime or UI-facing adapters:

1. Provider live stat payload
2. G46A identity mapping supplies the AllFantasy player ID
3. `normalizeNflRedraftProviderLiveScoringContext`
4. `NflRedraftLiveScoringContext`
5. `scoreRowsFromCanonicalLiveScoringContexts`
6. `buildNflRedraftLiveScoringRuntimeState`
7. Matchup, roster, team, and player-card display adapters

React components and display adapters consume canonical AllFantasy fields only. Provider-specific player IDs and raw provider payloads are not serialized into the canonical live scoring object.

## Supported Fields

`NflRedraftLiveScoringContext` supports:

- AllFantasy player ID
- game ID
- season and week
- live game status
- quarter and clock
- final game state
- live stat line
- projected fantasy points
- actual fantasy points
- canonical stat correction records
- scoring refresh timestamp
- matchup refresh timestamp
- standings refresh trigger and reason
- provider freshness metadata
- provider fallback metadata

## Scoring Refresh Flow

Canonical live contexts can be converted to runtime score rows with `scoreRowsFromCanonicalLiveScoringContexts`.

The NFL redraft scoring runtime remains the source of truth:

- Provider stat lines supply stats.
- League scoring rules calculate fantasy points.
- Starter-only totals still drive matchup scores.
- Final game states mark matchups complete when all starters are finalized.
- Runtime refresh metadata exposes the latest scoring and matchup refresh timestamps.
- Standings refresh is requested when games finalize or stat corrections are applied.

Provider-provided fantasy points are preserved as context but do not bypass league scoring rules.

## Stat Correction Flow

Canonical stat corrections include:

- correction ID
- player ID
- game ID
- stat category
- old value
- new value
- fantasy point delta
- provider source
- timestamp
- applied status

`applyCanonicalNflRedraftStatCorrection` records a numeric applied marker derived from the correction ID. Replaying the same correction returns `applied: false` and does not increment the correction version, preventing double-application.

## Fallback Behavior

Missing live stats, game status, game ID, season, week, or fantasy-point fields are represented as fallback fields. The system does not invent stats, scores, game state, or correction records.

Provider fallback metadata travels with the canonical context so UI surfaces can show unavailable or fallback states without knowing provider payload shape.

## Freshness Behavior

G47B reuses the G45 provider freshness model. Live scoring defaults to short freshness windows for live-score providers and long windows for deterministic fixtures. Stale records carry warnings through:

- player-data adapters
- roster merge rows
- matchup card context
- display player records
- live scoring runtime state

## Surfaces Wired

G47B wires canonical live scoring context into:

- Matchup player context
- Roster merge rows
- Team/player display records
- Player cards via display records
- Draft room row helpers
- Live scoring runtime player scores
- Matchup score refresh metadata
- Standings refresh trigger metadata

No page redesigns were made.

## Remaining G48 Work

G48 should expose evidence packets for external OS consumers using these canonical fields. It should not add LLM conclusions. Provider integrations can now attach live stat, scoring refresh, and stat correction evidence without changing UI components.
