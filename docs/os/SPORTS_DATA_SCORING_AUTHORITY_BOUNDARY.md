# Scoring Authority Boundary (Phase 5H-f)

**INVARIANT (unchanged in 5H-f):**
```
Certified sports facts   ≠   Production scoring authority
```
Certified `sports_data` statistics are **observational evidence only**. Projections, valuations, injuries, and availability **never** change fantasy points. The existing production scoring pipeline remains authoritative. **No scoring-authority migration is permitted in this phase.** Code declaration: `lib/sports-data-gateway/scoring/scoringAuthorityBoundary.ts`; enforcement: `__tests__/fantasy-os/scoring-authority-boundary-5hf.test.ts`.

## Authoritative production scoring flow (verified in code, 5H-f audit)
| Stage | Authoritative table | Authoritative service |
|---|---|---|
| raw stat ingest | `PlayerGameLogCache` | `lib/sports-os/PlayerGameLogImportService.ts` |
| score compute | `PlayerWeeklyScore` | `lib/redraft/playerWeeklyScoreService.ts` → `calculateScoreFromSportConfig` (`lib/redraft/scoringEngine.ts`) |
| matchup total | `RedraftMatchup` | `lib/redraft/scoringEngine.ts::updateMatchupScores` |
| standings | `RedraftRoster` / `FantasyStanding` | `lib/redraft/standingsEngine.ts::updateStandings` |
| finalization | `RedraftMatchup.status` + `PlayerWeeklyScore.isFinalized` | `updateMatchupScores` / `resolveNflRedraftLiveScoringRuntime` |
Stat corrections: `applyNflRedraftStatCorrectionToSeason` recomputes from corrected stats, preserves finalized, stamps a monotonic `correctionVersion` (+ `StatReprocessLog`).

## Certified `sports_data` statistics — CONFIRMED not a scoring input
The certified statistics snapshot (Phase 5F) is **not read by any scoring/points path**. Its only scoring-adjacent use is gated (`FANTASY_OS_SPORTS_DATA_SCORING_ENABLED`, **default-off**) and **stricter-only**: it can set `isFinal=false` (delay finalization), never supply points, never finalize, and fails open. `scoringIntegration.ts` declares `certifiedPlayerStatistics: 'certified-not-scoring-input'`.

## Enforcement (test-locked)
The scoring engines (`redraft/scoringEngine`, `redraft/playerWeeklyScoreService`, `redraft/standingsEngine`, `scoring-engine/ScoringCalculator`, `nfl-scoring/scoringKeyBridge`) must import NONE of: certified statistics runtime, certified reads, canonical value/image, canonical persistence, or factual domains. Fails if any scorer imports a certified/canonical fact module, if projection/value data reaches scoring, or if injury/availability changes points.

## Future scoring-authority certification (DESIGN ONLY — not executed)
A future migration would require, behind an explicit gate: historical backfill · sport-by-sport comparison · scoring-format coverage · stat-correction handling · identity coverage · team-defense + IDP coverage · official game-final · duplicate suppression · late-correction replay · matchup-total parity · standings parity · playoff parity · commissioner-override compatibility · rollback · shadow period · explicit production authorization. **Target** thresholds (NOT claimed passed): 100% game-identity match; 100% rostered-player identity or explicit unsupported; 100% deterministic rerun; 0 duplicate scoring rows; 0 projection/value contamination; documented variance for every mismatched stat; no unexplained matchup-total difference.

## Known caveat (pre-existing, not introduced here)
Three overlapping `PlayerWeeklyScore` writers (`playerWeeklyScoreService`, `resolveNflRedraftLiveScoringRuntime`, `liveScoreRunner`) share the unique key but disagree on `isFinalized` authority. This is a pre-existing production concern documented for a future scoring increment — **not** changed in 5H-f.
