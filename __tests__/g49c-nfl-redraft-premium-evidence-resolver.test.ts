import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from './helpers/createMockNextRequest'
import {
  NFL_REDRAFT_PROVIDER_EVIDENCE_PACKET_MODEL_VERSION,
  type NflRedraftEvidenceSurface,
  type NflRedraftEvidenceType,
  type NflRedraftProviderEvidencePacket,
} from '@/lib/player-data/nflRedraftProviderEvidencePackets'
import {
  buildNflRedraftPremiumProductContract,
  resolveNflRedraftPremiumEvidence,
  type NflRedraftPremiumProductContractResult,
} from '@/lib/redraft-premium'

const INGESTED = '2026-09-13T18:16:00.000Z'

const premiumRouteMocks = vi.hoisted(() => ({
  enforceAccess: vi.fn(),
  loadEvidence: vi.fn(),
}))

vi.mock('@/lib/redraft-premium/nflRedraftPremiumAccessBoundary', () => ({
  enforceNflRedraftPremiumAccess: premiumRouteMocks.enforceAccess,
  stripClientEntitlementForServerResolution: (requestBody: Record<string, unknown>, entitlement: { status: string; plans: string[] }) => {
    const rest = { ...requestBody }
    delete rest.requestedTier
    delete rest.entitlement
    return { ...rest, entitlement: { status: entitlement.status, plans: entitlement.plans } }
  },
}))

vi.mock('@/lib/redraft-premium/nflRedraftPremiumProductionEvidenceSource', () => ({
  loadNflRedraftPremiumProductionEvidence: premiumRouteMocks.loadEvidence,
}))

beforeEach(() => {
  premiumRouteMocks.enforceAccess.mockResolvedValue({
    ok: true,
    userId: 'user-g49c',
    userEmail: 'user-g49c@example.com',
    isLeagueMember: true,
    isCommissioner: true,
    entitlement: { status: 'none', plans: [], currentPeriodEnd: null, gracePeriodEnd: null },
  })
  premiumRouteMocks.loadEvidence.mockResolvedValue([])
})

const SURFACES_BY_TYPE: Record<NflRedraftEvidenceType, NflRedraftEvidenceSurface[]> = {
  player_identity: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  player_metadata_media: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  projection: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  injury: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  news: ['draft', 'waiver', 'trade', 'team', 'player_card'],
  ranking_adp: ['draft', 'mock_draft', 'waiver', 'trade', 'player_card'],
  schedule_game_context: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  weather: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  live_stats: ['roster', 'matchup', 'team', 'player_card', 'live_scoring'],
  fantasy_scoring: ['matchup', 'team', 'player_card', 'live_scoring', 'standings'],
  stat_correction: ['matchup', 'live_scoring', 'standings', 'audit'],
  roster_context: ['roster', 'team', 'player_card'],
  matchup_context: ['matchup', 'team', 'player_card'],
  waiver_context: ['waiver', 'player_card'],
  trade_context: ['trade', 'player_card'],
  draft_context: ['draft', 'mock_draft', 'player_card'],
}

function packet(
  evidenceType: NflRedraftEvidenceType,
  overrides: Partial<NflRedraftProviderEvidencePacket> = {},
): NflRedraftProviderEvidencePacket {
  const stale = overrides.stale ?? overrides.freshnessStatus === 'stale'
  const missing = overrides.missing ?? overrides.freshnessStatus === 'missing'
  const fallback = overrides.fallback ?? false
  return {
    modelVersion: NFL_REDRAFT_PROVIDER_EVIDENCE_PACKET_MODEL_VERSION,
    evidenceId: `g49c-${evidenceType}`,
    evidenceType,
    canonicalLeagueId: 'league-g49c',
    canonicalTeamId: 'team-g49c',
    canonicalPlayerId: 'player-g49c',
    canonicalGameId: 'game-g49c',
    canonicalMatchupId: 'matchup-g49c',
    sourceProvider: 'sportsdataio',
    providerCapabilityDomain: 'player_metadata',
    sourceTimestampIso: '2026-09-13T18:10:00.000Z',
    ingestedTimestampIso: INGESTED,
    freshnessStatus: 'available',
    stale,
    missing,
    fallback,
    confidenceLevel: missing ? 'unknown' : fallback || stale ? 'low' : 'high',
    affectedSurfaces: SURFACES_BY_TYPE[evidenceType],
    canonicalFieldNamesIncluded: [evidenceType],
    facts: { canonicalOnly: true, providerPayload: { token: 'do-not-leak' } },
    errorMetadata: null,
    retryRateLimitMetadata: null,
    internalDebugReference: null,
    ...overrides,
  }
}

function evidencePackets(): NflRedraftProviderEvidencePacket[] {
  return [
    packet('player_identity'),
    packet('projection', { providerCapabilityDomain: 'projection' }),
    packet('injury', { providerCapabilityDomain: 'injury' }),
    packet('news', { providerCapabilityDomain: 'news' }),
    packet('schedule_game_context', { providerCapabilityDomain: 'schedule' }),
    packet('weather', {
      sourceProvider: 'openweather',
      providerCapabilityDomain: 'weather',
      freshnessStatus: 'stale',
      stale: true,
      fallback: true,
    }),
    packet('live_stats', { providerCapabilityDomain: 'live_score' }),
    packet('fantasy_scoring', { providerCapabilityDomain: 'live_score' }),
    packet('stat_correction', { providerCapabilityDomain: 'live_score' }),
    packet('roster_context'),
    packet('matchup_context', { providerCapabilityDomain: 'live_score' }),
    packet('waiver_context', { freshnessStatus: 'missing', missing: true, fallback: true }),
    packet('trade_context'),
    packet('draft_context'),
  ]
}

const canonicalIds = {
  leagueId: 'league-g49c',
  teamId: 'team-g49c',
  managerId: 'manager-g49c',
  matchupId: 'matchup-g49c',
  playerId: 'player-g49c',
  week: 1,
  season: 2026,
}

function expectFactsOnly(result: unknown) {
  const json = JSON.stringify(result).toLowerCase()
  expect(json).not.toContain('providerpayload')
  expect(json).not.toContain('rawproviderpayload')
  expect(json).not.toContain('do-not-leak')
  expect(json).not.toContain('sportsdataio')
  expect(json).not.toContain('start this player')
  expect(json).not.toContain('waiver priority')
  expect(json).not.toContain('make this trade')
  expect(json).not.toContain('collusion')

  const forbiddenKeys = new Set(['recommendation', 'recommendations', 'reasoning', 'llm', 'llmsummary', 'conclusion'])
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      expect(forbiddenKeys.has(key.toLowerCase())).toBe(false)
      visit(entry)
    }
  }
  visit(result)
}

describe('G49C NFL redraft premium evidence resolver and route hardening', () => {
  it('selects service-specific canonical evidence packets without provider payload leakage', () => {
    const resolved = resolveNflRedraftPremiumEvidence({
      serviceId: 'matchup_prep',
      canonicalIds,
      availableEvidencePackets: evidencePackets(),
      ingestedAtIso: INGESTED,
    })

    expect(resolved.resolverStatus.status).toBe('resolved')
    expect(resolved.evidencePackets.map((item) => item.evidenceType)).toEqual(
      expect.arrayContaining(['projection', 'injury', 'schedule_game_context', 'weather', 'live_stats', 'fantasy_scoring', 'matchup_context']),
    )
    expect(resolved.evidencePackets.map((item) => item.evidenceType)).not.toContain('waiver_context')
    expect(resolved.evidenceCounts.selected).toBe(resolved.evidencePackets.length)
    expect(resolved.evidenceCounts.byType.matchup_context).toBeGreaterThan(0)
    expectFactsOnly(
      buildNflRedraftPremiumProductContract(
        { serviceType: 'matchup_prep', leagueId: 'league-g49c', matchupId: 'matchup-g49c', playerId: 'player-g49c', requestedTier: 'AF_PRO' },
        {
          evidencePackets: resolved.evidencePackets,
          resolverStatus: resolved.resolverStatus,
          evidenceCounts: resolved.evidenceCounts,
          generatedAtIso: INGESTED,
        },
      ),
    )
  })

  it('reports empty evidence fallback behavior and request-context-only partial resolution', () => {
    const empty = resolveNflRedraftPremiumEvidence({
      serviceId: 'basic_runtime_facts',
      canonicalIds: { ...canonicalIds, teamId: null, matchupId: null, playerId: null },
      availableEvidencePackets: [],
      ingestedAtIso: INGESTED,
    })
    const partial = resolveNflRedraftPremiumEvidence({
      serviceId: 'waiver_report',
      canonicalIds,
      availableEvidencePackets: [],
      ingestedAtIso: INGESTED,
    })

    expect(empty.resolverStatus).toMatchObject({ status: 'empty', messages: ['no_matching_canonical_evidence'] })
    expect(empty.evidenceCounts.selected).toBe(0)
    expect(partial.resolverStatus).toMatchObject({ status: 'partial', messages: ['request_context_only'] })
    expect(partial.evidencePackets.map((item) => item.evidenceType)).toEqual(['waiver_context'])
    expect(partial.evidenceCounts.byType.waiver_context).toBe(1)
  })

  it('propagates stale, fallback, missing warnings and evidence counts into product packets', () => {
    const resolved = resolveNflRedraftPremiumEvidence({
      serviceId: 'waiver_report',
      canonicalIds,
      availableEvidencePackets: evidencePackets(),
      ingestedAtIso: INGESTED,
    })
    const result = buildNflRedraftPremiumProductContract(
      { serviceType: 'waiver_report', leagueId: 'league-g49c', playerId: 'player-g49c', requestedTier: 'AF_PRO', generatedAtIso: INGESTED },
      {
        evidencePackets: resolved.evidencePackets,
        resolverStatus: resolved.resolverStatus,
        evidenceCounts: resolved.evidenceCounts,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected product packet')
    expect(result.resolverStatus.status).toBe('resolved')
    expect(result.evidenceCounts.missing).toBeGreaterThan(0)
    expect(result.evidenceCounts.fallback).toBeGreaterThan(0)
    expect(result.evidenceCounts.stale).toBeGreaterThan(0)
    expect(result.staleDataWarnings).toEqual(expect.arrayContaining([expect.stringContaining('weather:')]))
    expect(result.missingDataWarnings).toEqual(expect.arrayContaining([expect.stringContaining('waiver_context:')]))
    expect(result.fallbackWarnings).toEqual(expect.arrayContaining([expect.stringContaining('g49c-weather')]))
    expectFactsOnly(result)
  })

  it('rejects invalid service, invalid canonical IDs, invalid tier, provider IDs, and unknown fields safely', () => {
    const invalidService = buildNflRedraftPremiumProductContract({ serviceType: 'bad_service', leagueId: 'league-g49c' })
    const invalidId = buildNflRedraftPremiumProductContract({ serviceType: 'manager_brief', leagueId: 'league:g49c' })
    const invalidTier = buildNflRedraftPremiumProductContract({ serviceType: 'manager_brief', leagueId: 'league-g49c', requestedTier: 'PRO_PLUS' })
    const providerId = buildNflRedraftPremiumProductContract({
      serviceType: 'manager_brief',
      leagueId: 'league-g49c',
      providerPlayerId: 'sportsdataio-123',
    } as never)
    const unknownField = buildNflRedraftPremiumProductContract({ serviceType: 'manager_brief', leagueId: 'league-g49c', prompt: 'help me' } as never)

    expect(invalidService).toMatchObject({ ok: false, error: { code: 'unknown_service' } })
    expect(invalidId).toMatchObject({ ok: false, error: { code: 'invalid_request', fields: ['leagueId'] } })
    expect(invalidTier).toMatchObject({ ok: false, error: { code: 'invalid_tier', fields: ['requestedTier'] } })
    expect(providerId).toMatchObject({ ok: false, error: { code: 'provider_input_rejected', fields: ['providerPlayerId'] } })
    expect(unknownField).toMatchObject({ ok: false, error: { code: 'invalid_request', fields: ['prompt'] } })
    for (const result of [invalidService, invalidId, invalidTier, providerId, unknownField]) expectFactsOnly(result)
  })

  it('returns entitlement-denied packets without bypassing access checks', () => {
    const result = buildNflRedraftPremiumProductContract(
      { serviceType: 'war_room', leagueId: 'league-g49c', entitlement: { status: 'active', plans: ['pro'] } },
      { evidencePackets: evidencePackets(), generatedAtIso: INGESTED },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected product packet')
    expect(result.accessStatus).toMatchObject({
      allowed: false,
      requiredTier: 'AF_WAR_ROOM',
      requestedTier: 'FREE',
      reason: 'tier_required',
    })
    expect(result.resolverStatus.source).toBe('canonical_evidence_resolver')
    expectFactsOnly(result)
  })

  it('hardens the POST route with stable safe responses and resolver metadata', async () => {
    const { POST } = await import('../app/api/redraft/premium-services/route')
    const okReq = createMockNextRequest('http://localhost/api/redraft/premium-services', {
      method: 'POST',
      body: {
        serviceType: 'matchup_prep',
        leagueId: 'league-g49c',
        matchupId: 'matchup-g49c',
        requestedTier: 'FREE',
        week: 1,
        season: 2026,
      },
    })
    const okRes = await POST(okReq)
    const okBody = await okRes.json()

    expect(okRes.status).toBe(200)
    expect(okBody).toMatchObject({
      ok: true,
      serviceType: 'matchup_prep',
      accessStatus: { allowed: false, requiredTier: 'AF_PRO' },
      resolverStatus: { status: 'partial', source: 'canonical_evidence_resolver' },
      evidenceCounts: { selected: 1, byType: { matchup_context: 1 } },
    })
    expect(okBody.evidencePacketIds.length).toBe(1)
    expectFactsOnly(okBody)

    const invalidJson = new NextRequest('http://localhost/api/redraft/premium-services', {
      method: 'POST',
      body: '{bad json',
      headers: { 'content-type': 'application/json' },
    })
    const invalidJsonRes = await POST(invalidJson)
    const invalidJsonBody = await invalidJsonRes.json()

    expect(invalidJsonRes.status).toBe(400)
    expect(invalidJsonBody).toMatchObject({ ok: false, error: { code: 'invalid_request', fields: ['body'] } })
    expectFactsOnly(invalidJsonBody)
  })

  it('rejects route-level provider IDs and invalid canonical IDs without leaking secrets', async () => {
    const { POST } = await import('../app/api/redraft/premium-services/route')
    const providerReq = createMockNextRequest('http://localhost/api/redraft/premium-services', {
      method: 'POST',
      body: {
        serviceType: 'manager_brief',
        leagueId: 'league-g49c',
        providerPlayerId: 'sportsdataio-123',
      },
    })
    const invalidIdReq = createMockNextRequest('http://localhost/api/redraft/premium-services', {
      method: 'POST',
      body: {
        serviceType: 'manager_brief',
        leagueId: 'league:g49c',
      },
    })

    const providerRes = await POST(providerReq)
    const providerBody = await providerRes.json()
    const invalidIdRes = await POST(invalidIdReq)
    const invalidIdBody = await invalidIdRes.json()

    expect(providerRes.status).toBe(400)
    expect(providerBody).toMatchObject({ ok: false, error: { code: 'provider_input_rejected' } })
    expect(invalidIdRes.status).toBe(400)
    expect(invalidIdBody).toMatchObject({ ok: false, error: { code: 'invalid_request', fields: ['leagueId'] } })
    expectFactsOnly(providerBody)
    expectFactsOnly(invalidIdBody)
  })
})
