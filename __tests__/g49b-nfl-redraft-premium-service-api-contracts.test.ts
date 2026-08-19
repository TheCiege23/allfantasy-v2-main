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
  resolveNflRedraftPremiumTierFromEntitlement,
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
    userId: 'user-g49b',
    userEmail: 'user-g49b@example.com',
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
    evidenceId: `packet-${evidenceType}`,
    evidenceType,
    canonicalLeagueId: 'league-g49b',
    canonicalTeamId: 'team-g49b',
    canonicalPlayerId: 'player-g49b',
    canonicalGameId: null,
    canonicalMatchupId: null,
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
    facts: { canonicalOnly: true, field: evidenceType, providerPayload: { secret: 'do-not-leak' } },
    errorMetadata: null,
    retryRateLimitMetadata: null,
    internalDebugReference: null,
    ...overrides,
  }
}

function evidencePackets(): NflRedraftProviderEvidencePacket[] {
  return [
    packet('projection', { providerCapabilityDomain: 'projection' }),
    packet('injury', { providerCapabilityDomain: 'injury' }),
    packet('schedule_game_context', { sourceProvider: 'thesportsdb', providerCapabilityDomain: 'schedule' }),
    packet('weather', {
      sourceProvider: 'openweather',
      providerCapabilityDomain: 'weather',
      freshnessStatus: 'stale',
      stale: true,
      fallback: true,
    }),
    packet('matchup_context', { providerCapabilityDomain: 'live_score', canonicalMatchupId: 'matchup-g49b' }),
    packet('waiver_context', {
      freshnessStatus: 'missing',
      missing: true,
      fallback: true,
      facts: { canonicalOnly: true, unavailable: true },
    }),
    packet('trade_context'),
    packet('draft_context', { providerCapabilityDomain: 'mock_draft' }),
  ]
}

function expectFactsOnly(result: NflRedraftPremiumProductContractResult) {
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

describe('G49B NFL redraft premium service API contracts', () => {
  it('returns product-ready service contract shape from G49A summaries', () => {
    const result = buildNflRedraftPremiumProductContract(
      {
        serviceType: 'matchup_prep',
        leagueId: 'league-g49b',
        teamId: 'team-g49b',
        managerId: 'manager-g49b',
        matchupId: 'matchup-g49b',
        playerId: 'player-g49b',
        week: 1,
        season: 2026,
        requestedTier: 'AF_PRO',
        generatedAtIso: INGESTED,
      },
      { evidencePackets: evidencePackets() },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected product packet')
    expect(result).toMatchObject({
      serviceType: 'matchup_prep',
      serviceName: 'Matchup Prep Service',
      requiredTier: 'AF_PRO',
      accessStatus: { allowed: true, requestedTier: 'AF_PRO' },
      canonicalIds: {
        leagueId: 'league-g49b',
        teamId: 'team-g49b',
        managerId: 'manager-g49b',
        matchupId: 'matchup-g49b',
        playerId: 'player-g49b',
        week: 1,
        season: 2026,
      },
      factsOnly: true,
      deterministic: true,
      generatedAtIso: INGESTED,
    })
    expect(result.evidencePacketIds).toEqual(expect.arrayContaining(['packet-projection', 'packet-matchup_context']))
    expect(result.eligibleSurfaces).toEqual(expect.arrayContaining(['matchup', 'player_card']))
    expect(result.factualCategoryLabels).toEqual(expect.arrayContaining(['projection_context', 'matchup_context']))
    expectFactsOnly(result)
  })

  it('enforces tier access allowed and denied states deterministically', () => {
    const denied = buildNflRedraftPremiumProductContract(
      { serviceType: 'manager_brief', leagueId: 'league-g49b', requestedTier: 'FREE' },
      { evidencePackets: evidencePackets(), generatedAtIso: INGESTED },
    )
    const allowed = buildNflRedraftPremiumProductContract(
      {
        serviceType: 'commissioner_digest',
        serviceVariant: 'commissioner',
        leagueId: 'league-g49b',
        entitlement: { status: 'active', plans: ['commissioner'] },
      },
      { evidencePackets: evidencePackets(), generatedAtIso: INGESTED },
    )

    expect(denied.ok).toBe(true)
    expect(allowed.ok).toBe(true)
    if (!denied.ok || !allowed.ok) throw new Error('expected product packets')
    expect(denied.accessStatus).toMatchObject({ allowed: false, requiredTier: 'AF_PRO', reason: 'tier_required' })
    expect(allowed.accessStatus).toMatchObject({ allowed: true, requestedTier: 'AF_COMMISSIONER' })
    expectFactsOnly(denied)
    expectFactsOnly(allowed)
  })

  it('maps existing entitlement plans to G49A service tiers without Stripe changes', () => {
    expect(
      resolveNflRedraftPremiumTierFromEntitlement({
        serviceId: 'manager_brief',
        status: 'active',
        plans: ['pro'],
      }),
    ).toBe('AF_PRO')
    expect(
      resolveNflRedraftPremiumTierFromEntitlement({
        serviceId: 'commissioner_digest',
        status: 'grace',
        plans: ['commissioner'],
      }),
    ).toBe('AF_COMMISSIONER')
    expect(
      resolveNflRedraftPremiumTierFromEntitlement({
        serviceId: 'draft_prep',
        variant: 'advanced',
        status: 'active',
        plans: ['supreme'],
      }),
    ).toBe('AF_SUPREME')
    expect(
      resolveNflRedraftPremiumTierFromEntitlement({
        serviceId: 'war_room',
        status: 'active',
        plans: ['war_room'],
      }),
    ).toBe('AF_WAR_ROOM')
    expect(
      resolveNflRedraftPremiumTierFromEntitlement({
        serviceId: 'war_room',
        status: 'expired',
        plans: ['war_room'],
      }),
    ).toBe('FREE')
  })

  it('rejects unknown services and provider-specific input fields', () => {
    const unknown = buildNflRedraftPremiumProductContract({ serviceType: 'lineup_optimizer', leagueId: 'league-g49b' })
    const providerInput = buildNflRedraftPremiumProductContract({
      serviceType: 'manager_brief',
      leagueId: 'league-g49b',
      providerPlayerId: 'sportsdataio-123',
    } as never)

    expect(unknown).toMatchObject({ ok: false, error: { code: 'unknown_service', fields: ['serviceType'] } })
    expect(providerInput).toMatchObject({
      ok: false,
      error: { code: 'provider_input_rejected', fields: ['providerPlayerId'] },
    })
    expectFactsOnly(unknown)
    expectFactsOnly(providerInput)
  })

  it('propagates stale, fallback, missing, and evidence-packet warnings', () => {
    const result = buildNflRedraftPremiumProductContract(
      { serviceType: 'waiver_report', leagueId: 'league-g49b', requestedTier: 'AF_PRO' },
      { evidencePackets: evidencePackets(), generatedAtIso: INGESTED },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected product packet')
    expect(result.evidencePacketIds).toEqual(expect.arrayContaining(['packet-weather', 'packet-waiver_context']))
    expect(result.freshnessWarnings.overall).toBe('missing')
    expect(result.staleDataWarnings).toEqual(expect.arrayContaining([expect.stringContaining('weather:')]))
    expect(result.fallbackWarnings).toEqual(expect.arrayContaining(['fallback:packet-weather', 'fallback:packet-waiver_context']))
    expect(result.missingDataWarnings).toEqual(expect.arrayContaining([expect.stringContaining('waiver_context:')]))
    expect(result.unavailableDataMessages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('missing:waiver_context:'),
        expect.stringContaining('stale:weather:'),
      ]),
    )
    expectFactsOnly(result)
  })

  it('keeps contract output deterministic for identical input', () => {
    const request = {
      serviceType: 'draft_prep',
      leagueId: 'league-g49b',
      playerId: 'player-g49b',
      requestedTier: 'AF_PRO',
    }
    const first = buildNflRedraftPremiumProductContract(request, { evidencePackets: evidencePackets() })
    const second = buildNflRedraftPremiumProductContract(request, { evidencePackets: evidencePackets() })

    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('expected product packet')
    expect(first.generatedAtIso).toBe('1970-01-01T00:00:00.000Z')
    expectFactsOnly(first)
  })

  it('exposes the POST route contract without accepting provider payloads', async () => {
    const { POST } = await import('../app/api/redraft/premium-services/route')
    const okReq = createMockNextRequest('http://localhost/api/redraft/premium-services', {
      method: 'POST',
      body: {
        serviceType: 'basic_runtime_facts',
        leagueId: 'league-g49b',
        requestedTier: 'FREE',
      },
    })
    const okRes = await POST(okReq)
    const okBody = await okRes.json()

    expect(okRes.status).toBe(200)
    expect(okBody).toMatchObject({
      ok: true,
      serviceType: 'basic_runtime_facts',
      accessStatus: { allowed: true, requestedTier: 'FREE' },
    })
    expect(okBody.unavailableDataMessages).toContain('unavailable:no_matching_canonical_evidence')

    const rejectedReq = createMockNextRequest('http://localhost/api/redraft/premium-services', {
      method: 'POST',
      body: {
        serviceType: 'basic_runtime_facts',
        leagueId: 'league-g49b',
        sourceProvider: 'sportsdataio',
      },
    })
    const rejectedRes = await POST(rejectedReq)
    const rejectedBody = await rejectedRes.json()

    expect(rejectedRes.status).toBe(400)
    expect(rejectedBody).toMatchObject({ ok: false, error: { code: 'provider_input_rejected' } })
    expectFactsOnly(okBody)
    expectFactsOnly(rejectedBody)
  })
})
