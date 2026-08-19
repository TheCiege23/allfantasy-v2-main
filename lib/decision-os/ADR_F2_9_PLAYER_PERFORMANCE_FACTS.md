# ADR F2.9 — Player Performance Facts (warehouse `PlayerGameFact` derived VIEW)

**Status:** Proposed → Built (shadow-consumable). **Date:** 2026-07-21.
**Freeze compliance:** additive read-only port + derived view — the category `ARCHITECTURE_FREEZE.md`
explicitly allows without an architectural ADR; documented here anyway because it introduces the
Decision OS's FIRST warehouse-fact dependency, which future slices will build on.

## Context

The 2026-07-21 P0 release gave production a real per-game player-stat warehouse for the first time:
`PlayerGameFact` (40,473 rows, NFL 2025 weeks 1–18, ledger-verified complete, stat/fact counts
reconcile). Nothing in the Decision OS reads it. Every decision slice that wants "how has this
player actually performed" has no sourced answer — the projection view (F2.5) answers "what is
expected", not "what happened".

## Decision

1. **Port** (`world/port.ts`, find\*-only): `loadPlayerGameFactRows(sport, ids, season)` — one
   bounded batched query (id set ≤ 200, mirroring `loadProjectionRows`), explicit select, no writes.
2. **Derived view** (`world/performanceEnrichedWorld.ts`): `PerformanceEnrichedCanonicalWorld`
   layering `PerformanceContext` onto each enriched player. Same invariant set as F2.5:
   - Pure `CanonicalWorld` untouched; all performance data lives on the view.
   - Origin never branches decisions; `PlayerGameFact.playerId` is the raw provider-id join key
     (identical id space — verified during the P0 release: Sleeper week-stat ids ARE roster ids).
   - **No fabrication (P2): a player with zero fact rows has `gamesPlayed: null`, not 0** — an
     empty warehouse is "unknown", never "played 0 games / scored 0 points". Every absence adds an
     `uncertainty[]` entry.
   - Season honesty: facts may cover a COMPLETED season while the league is in a later season
     (offseason). The view reports `seasonUsed` + a `season_mismatch` uncertainty rather than
     presenting last season's form as current.
   - Resolver never throws; port errors degrade to a world-level uncertainty.
3. **Query shape = the optimization**: one query per resolve for the entire roster set (batch
   loading), aggregation done in-process over ≤ 200×18 small rows. No caching layer yet — measured
   cost (prod, read-only) is single-digit ms; a memoized summary table is deferred until a consumer
   demonstrates need (see Phase-5 notes in the Decision OS data-layer architecture doc).

## Sourced-data coverage (prod census, 2026-07-21)

| Table | Rows | Verdict for this ADR |
|---|---|---|
| `dw_player_game_facts` | 40,473 | ✅ the source of this view |
| `dw_matchup_facts` | 1,186 | usable by a future matchup-history port (F2.10 candidate) |
| `dw_draft_facts` | 1,488 | future draft-strategy port candidate |
| `dw_roster_snapshots` | 180 | sparse — not yet a trustworthy trend source |
| `dw_season_standing_facts` / `dw_team_game_facts` / `dw_transaction_facts` | 0 | **must stay unavailable** in any consumer until a writer exists |

## Consequences

Decision slices (lineup first) can cite actual per-game history with provenance and honest gaps.
The registry's planned "performance-aware lineup enrichment" becomes buildable. No cutover state
changes; no flags added; no legacy path altered.
