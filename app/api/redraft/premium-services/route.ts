import { NextResponse } from 'next/server'
import {
  buildNflRedraftPremiumProductContract,
  buildNflRedraftPremiumProductError,
} from '@/lib/redraft-premium/nflRedraftPremiumApiContracts'
import {
  enforceNflRedraftPremiumAccess,
  stripClientEntitlementForServerResolution,
} from '@/lib/redraft-premium/nflRedraftPremiumAccessBoundary'
import { resolveNflRedraftPremiumEvidence } from '@/lib/redraft-premium/nflRedraftPremiumEvidenceResolver'
import { loadNflRedraftPremiumProductionEvidence } from '@/lib/redraft-premium/nflRedraftPremiumProductionEvidenceSource'
import {
  buildNflRedraftPremiumDiagnostics,
  buildNflRedraftPremiumEvidenceHealth,
  defaultNflRedraftPremiumBackfillStatus,
  logNflRedraftPremiumOperationalEvent,
  persistNflRedraftPremiumEvidenceSnapshot,
  type NflRedraftPremiumEvidenceSnapshotPersistenceResult,
} from '@/lib/redraft-premium/nflRedraftPremiumObservability'

export const dynamic = 'force-dynamic'

const PERSISTENCE_DISABLED: NflRedraftPremiumEvidenceSnapshotPersistenceResult = {
  status: 'unavailable',
  reason: 'request_not_resolved',
  evidenceSnapshotId: null,
  rawPayloadStored: false,
}

export async function POST(request: Request) {
  const routeStartedAt = Date.now()
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      {
        modelVersion: 'nfl-redraft-premium-api-contract-v1',
        ok: false,
        error: {
          code: 'invalid_request',
          message: 'Request body must be valid JSON.',
          fields: ['body'],
        },
      },
      { status: 400 },
    )
  }

  const requestBody = typeof body === 'object' && body ? body : {}
  const preflight = buildNflRedraftPremiumProductContract(requestBody)
  if (!preflight.ok) return NextResponse.json(preflight, { status: 400 })

  const access = await enforceNflRedraftPremiumAccess({
    leagueId: preflight.canonicalIds.leagueId ?? '',
    serviceId: preflight.serviceType,
    serviceVariant: preflight.serviceVariant,
  })
  if (!access.ok) {
    const diagnostics = buildNflRedraftPremiumDiagnostics({
      generatedAtIso: preflight.generatedAtIso,
      totalDurationMs: Date.now() - routeStartedAt,
      persistence: PERSISTENCE_DISABLED,
      accessDeniedReason: access.code,
      evidenceSource: 'unavailable',
    })
    logNflRedraftPremiumOperationalEvent({
      serviceId: preflight.serviceType,
      leagueId: preflight.canonicalIds.leagueId,
      status: 'denied',
      accessDeniedReason: access.code,
    })
    return NextResponse.json(
      buildNflRedraftPremiumProductError(access.code, access.message, access.fields, diagnostics),
      { status: access.status },
    )
  }

  const serverRequestBody = stripClientEntitlementForServerResolution(
    requestBody as Record<string, unknown>,
    access.entitlement,
  )
  const serverPreflight = buildNflRedraftPremiumProductContract(serverRequestBody)
  if (!serverPreflight.ok) return NextResponse.json(serverPreflight, { status: 400 })

  const productionEvidenceStartedAt = Date.now()
  const productionEvidence = await loadNflRedraftPremiumProductionEvidence({
    serviceId: serverPreflight.serviceType,
    canonicalIds: serverPreflight.canonicalIds,
    ingestedAtIso: serverPreflight.generatedAtIso,
  })
  const productionEvidenceDurationMs = Date.now() - productionEvidenceStartedAt

  const resolverStartedAt = Date.now()
  const resolved = resolveNflRedraftPremiumEvidence({
    serviceId: serverPreflight.serviceType,
    serviceVariant: serverPreflight.serviceVariant,
    canonicalIds: serverPreflight.canonicalIds,
    ingestedAtIso: serverPreflight.generatedAtIso,
    availableEvidencePackets: productionEvidence,
  })
  const resolverDurationMs = Date.now() - resolverStartedAt
  const evidenceHealth = buildNflRedraftPremiumEvidenceHealth(resolved.evidencePackets)
  const backfillStatus = defaultNflRedraftPremiumBackfillStatus(
    serverPreflight.canonicalIds.leagueId,
    serverPreflight.canonicalIds.season,
  )
  const persistence = await persistNflRedraftPremiumEvidenceSnapshot({
    serviceId: serverPreflight.serviceType,
    serviceVariant: serverPreflight.serviceVariant,
    canonicalIds: serverPreflight.canonicalIds,
    userId: access.userId,
    status: 200,
    durationMs: Date.now() - routeStartedAt,
    evidencePackets: resolved.evidencePackets,
    evidenceHealth,
    resolverStatus: resolved.resolverStatus,
    evidenceCounts: resolved.evidenceCounts,
    generatedAtIso: serverPreflight.generatedAtIso,
    enabled: process.env.NFL_REDRAFT_PREMIUM_EVIDENCE_PERSISTENCE === 'enabled',
  })
  const diagnostics = buildNflRedraftPremiumDiagnostics({
    generatedAtIso: serverPreflight.generatedAtIso,
    resolverDurationMs,
    productionEvidenceDurationMs,
    totalDurationMs: Date.now() - routeStartedAt,
    persistence,
    evidenceSource: productionEvidence.length > 0 ? 'production_canonical' : 'request_context',
  })

  const result = buildNflRedraftPremiumProductContract(serverRequestBody, {
    evidencePackets: resolved.evidencePackets,
    resolverStatus: resolved.resolverStatus,
    evidenceCounts: resolved.evidenceCounts,
    diagnostics,
    evidenceSnapshotId: persistence.evidenceSnapshotId,
    resolverDurationMs,
    evidenceHealth,
    backfillStatus,
    generatedAtIso: serverPreflight.generatedAtIso,
  })
  logNflRedraftPremiumOperationalEvent({
    serviceId: serverPreflight.serviceType,
    leagueId: serverPreflight.canonicalIds.leagueId,
    status: result.ok ? 'resolved' : 'error',
    evidenceSnapshotId: persistence.evidenceSnapshotId,
    evidenceHealth,
  })
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
