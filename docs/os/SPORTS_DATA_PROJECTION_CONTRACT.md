# Projection Contract (Phase 5H-f)

Code: `lib/sports-data-gateway/persistence/factualDomains.ts` (`CanonicalProjection`); table `sports_data.canonical_projection` (non-prod). Status: **contract designed · schema created · migration run (non-prod) · FIXTURE-ONLY proven**. NOT provider-certified. **Projections are DECISION EVIDENCE, never observed statistics, never valuations, never a scoring input.**

## Fields
`canonicalPlayerId, sport, source, sourcePlayerId, projectionType (provider_projection|allfantasy_projection), targetSeason, targetWeekOrPeriod, targetGameId, leagueFormat, scoringFormat, positionContext, projectedStatFields (jsonb), projectedFantasyPoints, rank, tier, confidenceBand, coverageStatus, freshnessStatus, generatedAt, retrievedAt, effectiveAt, expiresAt, sourceVersion, modelVersion, inputSnapshotReferences[], identityResolutionState, correctionOfId, supersedesId, provenance, unsupportedReason, contentHash, version, isActive, createdAt`.

## Strict boundary separation
`observed_statistic` · `derived_fantasy_points` · `provider_projection` · `allfantasy_projection` · `provider_valuation` · `allfantasy_valuation` · `ranking` · `adp` remain DISTINCT (aligned with `canonicalValue.ts`). Rules: no projection in observed-stat fields; no valuation used as a projection; scoring format explicit; target week/game explicit; missing confidence stays unsupported (`confidenceBand='unsupported'`); stale marked stale; model/source version required; AllFantasy projections require input freshness; unavailable stays unavailable.

## Source status (honest)
`FantasyProjection` (Prisma model) is **UNPOPULATED in production** — no importer writes it (only seed/diagnostic scripts). Live "projections" are a **heuristic derivation** (`lib/redraft/projectionEngine.ts::buildAllFantasyProjection`) with an ADP-derived fallback, explicitly flagged (`missingDataFlags`). Therefore the canonical projection table was proven with a **fixture-only** row, labeled as such. **The database model existing does NOT constitute projection certification.** No projection reaches production scoring (enforced — see scoring boundary).
