import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createMockNextRequest } from './helpers/createMockNextRequest'
import { buildSurfaceContextEvidencePacket } from '@/lib/player-data/nflRedraftProviderEvidencePackets'
import {
  buildNflRedraftPremiumDiagnostics,
  buildNflRedraftPremiumEvidenceHealth,
  defaultNflRedraftPremiumBackfillStatus,
  logNflRedraftPremiumOperationalEvent,
  persistNflRedraftPremiumEvidenceSnapshot,
  rebuildNflRedraftPremiumLeagueEvidenceSnapshots,
} from '@/lib/redraft-premium'

const routeMocks = vi.hoisted(() => ({
  enforceAccess: vi.fn(),
  loadEvidence: vi.fn(),
}))

vi.mock('@/lib/redraft-premium/nflRedraftPremiumAccessBoundary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/redraft-premium/nflRedraftPremiumAccessBoundary')>()
  return {
    ...actual,
    enforceNflRedraftPremiumAccess: routeMocks.enforceAccess,
  }
})

vi.mock('@/lib/redraft-premium/nflRedraftPremiumProductionEvidenceSource', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/redraft-premium/nflRedraftPremiumProductionEvidenceSource')>()
  return {
    ...actual,
    loadNflRedraftPremiumProductionEvidence: routeMocks.loadEvidence,
  }
})

const CANONICAL_IDS = {
  leagueId: 'league-g49f',
  teamId: 'roster-g49f',
  managerId: 'manager-g49f',
  matchupId: 'matchup-g49f',
  playerId: 'player-g49f',
  week: 1,
  season: 2026,
}

function rosterPacket() {
  return buildSurfaceContextEvidencePacket({
    evidenceType: 'roster_context',
    leagueId: CANONICAL_IDS.leagueId,
    teamId: CANONICAL_IDS.teamId,
    playerId: CANONICAL_IDS.playerId,
    sourceProvider: 'allfantasy',
    ingestedAtIso: '2026-09-14T00:00:00.000Z',
    facts: { rosterId: CANONICAL_IDS.teamId, playerCount: 16 },
  })
}

function staleFallbackPacket() {
  return buildSurfaceContextEvidencePacket({
    evidenceType: 'matchup_context',
    leagueId: CANONICAL_IDS.leagueId,
    teamId: CANONICAL_IDS.teamId,
    matchupId: CANONICAL_IDS.matchupId,
    sourceProvider: 'allfantasy',
    ingestedAtIso: '2026-09-14T00:00:00.000Z',
    freshness: {
      status: 'stale',
      updatedAtIso: '2026-09-10T00:00:00.000Z',
      stale: true,
      warnings: ['old_matchup_context'],
    },
    fallback: { fallback: true, fields: ['matchup_context'], labels: ['fallback_matchup_context'] },
    facts: { matchupId: CANONICAL_IDS.matchupId, status: 'scheduled' },
  })
}

function expectNoForbiddenOutput(value: unknown) {
  const text = JSON.stringify(value).toLowerCase()
  expect(text).not.toContain('rawproviderpayload')
  expect(text).not.toContain('providerpayload')
  expect(text).not.toContain('secret')
  expect(text).not.toContain('api_key')
  expect(text).not.toContain('recommendation')
  expect(text).not.toContain('reasoning')
  expect(text).not.toContain('start this player')
  expect(text).not.toContain('make this trade')
  expect(text).not.toContain('collusion')
}

beforeEach(() => {
  vi.clearAllMocks()
  routeMocks.enforceAccess.mockResolvedValue({
    ok: true,
    userId: 'user-g49f',
    userEmail: 'g49f@example.com',
    isLeagueMember: true,
    isCommissioner: true,
    entitlement: { status: 'none', plans: [], currentPeriodEnd: null, gracePeriodEnd: null },
  })
  routeMocks.loadEvidence.mockResolvedValue([rosterPacket()])
})

describe('G49F NFL redraft premium evidence persistence and observability', () => {
  it('summarizes provider evidence health counts without leaking payloads', () => {
    const health = buildNflRedraftPremiumEvidenceHealth([rosterPacket(), staleFallbackPacket()])

    expect(health).toMatchObject({
      totalPackets: 2,
      stalePackets: 1,
      fallbackPackets: 1,
      missingPackets: 0,
      byEvidenceType: { roster_context: 1, matchup_context: 1 },
      byProvider: { allfantasy: 2 },
    })
    expect(health.providerHealth[0]).toMatchObject({ provider: 'allfantasy', packetCount: 2 })
    expectNoForbiddenOutput(health)
  })

  it('persists sanitized evidence snapshots when existing operational storage is supplied', async () => {
    const create = vi.fn().mockResolvedValue({ id: 49 })
    const evidencePackets = [rosterPacket(), staleFallbackPacket()]
    const evidenceHealth = buildNflRedraftPremiumEvidenceHealth(evidencePackets)
    const result = await persistNflRedraftPremiumEvidenceSnapshot(
      {
        serviceId: 'manager_brief',
        canonicalIds: CANONICAL_IDS,
        userId: 'user-g49f',
        status: 200,
        durationMs: 12,
        evidencePackets,
        evidenceHealth,
        resolverStatus: { status: 'resolved', source: 'canonical_evidence_resolver', messages: ['selected_2'] },
        evidenceCounts: { totalAvailable: 2, selected: 2, stale: 1, fallback: 1, missing: 0, byType: { roster_context: 1 } },
        generatedAtIso: '2026-09-14T00:00:00.000Z',
        enabled: true,
      },
      { prismaClient: { apiUsageEvent: { create } } as never },
    )

    expect(result).toEqual({
      status: 'persisted',
      evidenceSnapshotId: '49',
      storage: 'api_usage_event',
      rawPayloadStored: false,
    })
    const createArg = create.mock.calls[0][0]
    expect(createArg.data.scope).toBe('nfl_redraft_premium')
    expect(createArg.data.meta).toMatchObject({
      factsOnly: true,
      rawPayloadStored: false,
      evidencePacketIds: expect.any(Array),
    })
    expect(createArg.data.meta.facts).toBeUndefined()
    expectNoForbiddenOutput(createArg)
  })

  it('returns unavailable persistence fallback when storage is not enabled', async () => {
    const result = await persistNflRedraftPremiumEvidenceSnapshot({
      serviceId: 'basic_runtime_facts',
      canonicalIds: CANONICAL_IDS,
      evidencePackets: [],
      evidenceHealth: buildNflRedraftPremiumEvidenceHealth([]),
      resolverStatus: { status: 'empty', source: 'canonical_evidence_resolver', messages: [] },
      evidenceCounts: { totalAvailable: 0, selected: 0, stale: 0, fallback: 0, missing: 0, byType: {} },
      generatedAtIso: '2026-09-14T00:00:00.000Z',
    })

    expect(result).toEqual({
      status: 'unavailable',
      reason: 'persistence_not_enabled',
      evidenceSnapshotId: null,
      rawPayloadStored: false,
    })
  })

  it('runs deterministic backfill hooks across all premium services', async () => {
    const loadEvidence = vi.fn().mockResolvedValue([rosterPacket()])
    const persistSnapshot = vi.fn().mockResolvedValue({
      status: 'persisted',
      evidenceSnapshotId: 'snapshot-g49f',
      storage: 'api_usage_event',
      rawPayloadStored: false,
    })

    const status = await rebuildNflRedraftPremiumLeagueEvidenceSnapshots(
      {
        leagueId: CANONICAL_IDS.leagueId,
        season: 2026,
        teamId: CANONICAL_IDS.teamId,
        playerId: CANONICAL_IDS.playerId,
        persist: true,
        generatedAtIso: '2026-09-14T00:00:00.000Z',
      },
      { loadEvidence, persistSnapshot },
    )

    expect(status).toMatchObject({
      status: 'completed',
      leagueId: CANONICAL_IDS.leagueId,
      season: 2026,
      servicesProcessed: 8,
      snapshotsPersisted: 8,
      evidencePacketsSeen: 8,
    })
    expect(loadEvidence).toHaveBeenCalledTimes(8)
    expect(persistSnapshot).toHaveBeenCalledTimes(8)
    expectNoForbiddenOutput(status)
  })

  it('builds diagnostics, default backfill status, and safe operational logs', () => {
    const persistence = {
      status: 'unavailable' as const,
      reason: 'persistence_not_enabled',
      evidenceSnapshotId: null,
      rawPayloadStored: false as const,
    }
    const diagnostics = buildNflRedraftPremiumDiagnostics({
      generatedAtIso: '2026-09-14T00:00:00.000Z',
      resolverDurationMs: 3.4,
      productionEvidenceDurationMs: 5.6,
      totalDurationMs: 10.2,
      persistence,
      evidenceSource: 'production_canonical',
    })
    const backfillStatus = defaultNflRedraftPremiumBackfillStatus(CANONICAL_IDS.leagueId, 2026)
    const logger = { info: vi.fn() }
    logNflRedraftPremiumOperationalEvent(
      {
        serviceId: 'manager_brief',
        leagueId: CANONICAL_IDS.leagueId,
        status: 'resolved',
        evidenceHealth: buildNflRedraftPremiumEvidenceHealth([rosterPacket()]),
      },
      { logger },
    )

    expect(diagnostics).toMatchObject({
      resolverDurationMs: 3,
      productionEvidenceDurationMs: 6,
      totalDurationMs: 10,
      persistenceStatus: 'unavailable',
      accessDeniedReason: null,
      safeLogging: { rawPayloadLogged: false, credentialValuesLogged: false },
    })
    expect(backfillStatus).toMatchObject({ status: 'not_requested', messages: ['backfill_not_requested'] })
    expect(logger.info).toHaveBeenCalledWith(
      '[nfl-redraft-premium]',
      expect.objectContaining({ rawPayloadLogged: false, credentialValuesLogged: false }),
    )
    expectNoForbiddenOutput({ diagnostics, backfillStatus, log: logger.info.mock.calls })
  })

  it('preserves G49E route shape while adding diagnostics and timing metadata', async () => {
    const { POST } = await import('../app/api/redraft/premium-services/route')
    const res = await POST(
      createMockNextRequest('http://localhost/api/redraft/premium-services', {
        method: 'POST',
        body: {
          serviceType: 'basic_runtime_facts',
          leagueId: CANONICAL_IDS.leagueId,
          teamId: CANONICAL_IDS.teamId,
        },
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      serviceType: 'basic_runtime_facts',
      resolverStatus: { source: 'canonical_evidence_resolver' },
      evidenceCounts: expect.any(Object),
      diagnostics: {
        schemaVersion: 'nfl-redraft-premium-diagnostics-v1',
        persistenceStatus: 'unavailable',
        accessDeniedReason: null,
      },
      evidenceHealth: { totalPackets: expect.any(Number) },
      backfillStatus: { status: 'not_requested' },
    })
    expect(typeof body.resolverDurationMs).toBe('number')
    expect(body.evidenceSnapshotId).toBeNull()
    expectNoForbiddenOutput(body)
  })

  it('tracks access denial reasons safely without changing error shape', async () => {
    const { POST } = await import('../app/api/redraft/premium-services/route')
    routeMocks.enforceAccess.mockResolvedValueOnce({
      ok: false,
      status: 401,
      code: 'unauthenticated',
      message: 'Authentication is required for NFL redraft premium services.',
      fields: ['session'],
    })

    const res = await POST(
      createMockNextRequest('http://localhost/api/redraft/premium-services', {
        method: 'POST',
        body: { serviceType: 'manager_brief', leagueId: CANONICAL_IDS.leagueId },
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'unauthenticated', fields: ['session'] },
      diagnostics: {
        accessDeniedReason: 'unauthenticated',
        evidenceSource: 'unavailable',
        safeLogging: { rawPayloadLogged: false, credentialValuesLogged: false },
      },
    })
    expectNoForbiddenOutput(body)
  })
})
