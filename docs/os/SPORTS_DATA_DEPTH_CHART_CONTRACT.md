# Depth Chart Contract (Phase 5H-f)

Code: `lib/sports-data-gateway/persistence/factualDomains.ts` (`CanonicalDepthChart`); table `sports_data.canonical_depth_chart` (non-prod). Status: **contract designed · schema created · migration run (non-prod) · FIXTURE-ONLY proven**. NOT provider-certified.

## Fields
`canonicalTeamId, canonicalPlayerId, sport, source, sourceTeamId, sourcePlayerId, positionDetail, depthRole, depthRank, unit, formationOrPackage, isStarter, origin (provider_supplied|derived), effectiveAt, retrievedAt, expiresAt, freshnessStatus, coverageStatus, identityResolutionState, sourceVersion, correctionOfId, supersedesId, provenance, unsupportedReason, contentHash, version, isActive, createdAt`.

## Rules
- Provider-supplied depth charts labeled `origin='provider_supplied'`; usage-derived ranking labeled `origin='derived'` — never conflated.
- Detailed position preserved (`positionDetail` via canonicalPosition).
- Depth rank must NOT alter league eligibility (eligibility computed at read time from league rules).
- Offensive / defensive / special-teams / sport-specific units isolated (`unit`).
- Unknown rank stays unknown; historical rows auditable (effective-dated + is_active).

## Source status (honest)
A **real** provider depth chart exists — RollingInsights `fetchNFLDepthCharts` (GraphQL `nflTeams.rosterByPosition`) → legacy `DepthChart` table (order-based starter, `players[0]`). But **Rolling Insights is `REQUIRES_WIRING`** (Phase 5H-d: DB-coupled client, no gateway adapter, no live probe). Therefore **no provider depth chart is gateway-certified**; the canonical table was proven with a **fixture-only** row, labeled as such. Live depth-chart certification requires the RI gateway adapter first. The legacy `DepthChart` table remains authoritative and unchanged.
