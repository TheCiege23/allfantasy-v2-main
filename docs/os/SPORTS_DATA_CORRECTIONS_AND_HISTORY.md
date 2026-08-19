# Corrections + History (Phase 5H-f)

Code: `lib/sports-data-gateway/persistence/factualDomains.ts` (`applyCorrection`, `resolveCurrent`, `resolveAsOf`, `CanonicalCorrection`, history types). Tables `sports_data.canonical_correction`, `canonical_player_team_history`, `canonical_player_position_history` (non-prod). Status: **contract designed · schema created · migration run (non-prod) · proven** (correction lineage on a real API-Sports injury; history rows effective-dated).

## Correction & effective-dating model (cross-domain)
`CanonicalCorrection`: `id, domain, canonicalRecordId, correctsRecordId, supersedesRecordId, source, sourceCorrectionId, reasonCode, reasonDescription, previousContentHash, correctedContentHash, effectiveAt, receivedAt, appliedAt, sourceVersion, provenance, version, createdAt`.
Rules (proven): never delete the original; a correction creates a **new effective-dated version** (`applyCorrection` returns the new version + the prior id to deactivate + the correction record); retrieval resolves the current effective record deterministically (`resolveCurrent`); **as-of queries return the historical fact even after it is deactivated** (`resolveAsOf`); duplicate corrections (same content hash + effective time) suppressed; out-of-order corrections resolve by `effectiveAt`, not insertion order; `source` (effective) and `receivedAt` (receipt) are distinct; lineage queryable (`correctsRecordId`); **rollback = toggling active/effective resolution, never deleting history**.
Proven in non-prod: injury `Questionable`→`Out` — current=`Out`, as-of 2026-06-05=`Questionable`, 2 versions retained, idempotent rerun 0 dups.

## Player-Team History (`CanonicalPlayerTeamHistory`)
`canonicalPlayerId, canonicalTeamId, sport, source, sourcePlayerId, sourceTeamId, relationshipType, startEffectiveAt, endEffectiveAt, retrievedAt, freshnessStatus, identityResolutionState, provenance, contentHash, version, isActive`. Team changes remain historical (effective periods). Fills a real gap: legacy `PlayerTeamHistory` has a **dead writer (0 callers) → unpopulated** in production.

## Player-Position History (`CanonicalPlayerPositionHistory`)
`canonicalPlayerId, sport, source, sourcePlayerId, providerPosition, canonicalDetailedPosition, startEffectiveAt, endEffectiveAt, ...`. Both provider position and canonical detailed position retained; position changes historical. Rules: **no name-only identity merge; no NCAAF→NFL continuity without a governed transition mapping; broad fantasy eligibility is NOT stored as permanent truth** (league-rule eligibility computed at read time via `canonicalPosition`). Fills a real gap: no legacy position-history table exists.

## Legacy correction machinery (retained, unchanged)
Score corrections already exist and are real: `applyNflRedraftStatCorrectionToSeason` (recompute + monotonic `correctionVersion` + `StatReprocessLog`, idempotent re-finalize). The canonical correction model **generalizes** this pattern across domains without touching scoring.
