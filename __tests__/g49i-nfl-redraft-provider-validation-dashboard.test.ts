import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NFL_REDRAFT_PRODUCTION_PROVIDER_WIRING_MODEL_VERSION,
  assertNflRedraftProviderValidationOutputSafe,
  buildNflRedraftCanonicalTraceView,
  buildNflRedraftProviderValidationDashboard,
  listNflRedraftLegacyDirectProviderAudit,
  type NflRedraftProductionProviderResolution,
} from '@/lib/nfl-provider'
import { buildSurfaceContextEvidencePacket } from '@/lib/player-data/nflRedraftProviderEvidencePackets'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { loadNflRedraftPremiumProductionEvidence } from '@/lib/redraft-premium/nflRedraftPremiumProductionEvidenceSource'

vi.mock('@/lib/adminAuth', () => ({
  requireAdminOrBearer: vi.fn(),
}))

vi.mock('@/lib/redraft-premium/nflRedraftPremiumProductionEvidenceSource', () => ({
  loadNflRedraftPremiumProductionEvidence: vi.fn(),
}))

const mockedRequireAdminOrBearer = vi.mocked(requireAdminOrBearer)
const mockedLoadProductionEvidence = vi.mocked(loadNflRedraftPremiumProductionEvidence)

function packet(overrides: {
  sourceProvider?: 'rolling_insights' | 'api_sports' | 'openweather' | 'allfantasy'
  playerId?: string | null
  gameId?: string | null
  stale?: boolean
  missing?: boolean
  fallback?: boolean
}) {
  return buildSurfaceContextEvidencePacket({
    evidenceType: 'matchup_context',
    leagueId: 'league-1',
    teamId: 'team-1',
    playerId: overrides.playerId ?? 'player-1',
    gameId: overrides.gameId ?? 'game-1',
    matchupId: 'matchup-1',
    sourceProvider: overrides.sourceProvider ?? 'rolling_insights',
    ingestedAtIso: '2026-09-13T18:02:00.000Z',
    freshness: {
      status: overrides.missing ? 'missing' : overrides.stale ? 'stale' : 'available',
      updatedAtIso: '2026-09-13T18:00:00.000Z',
      stale: overrides.stale ?? false,
    },
    fallback: {
      fallback: overrides.fallback ?? false,
      fields: overrides.missing ? ['missing:matchup_context'] : [],
      labels: [],
    },
    canonicalFieldNamesIncluded: ['matchupId', 'playerId', 'gameId'],
    facts: {
      matchupId: 'matchup-1',
      playerId: overrides.playerId ?? 'player-1',
      gameId: overrides.gameId ?? 'game-1',
      rawProviderPayload: { shouldBeRemoved: true },
      api_key: 'should-be-removed',
    },
  })
}

function resolution(): NflRedraftProductionProviderResolution {
  return {
    modelVersion: NFL_REDRAFT_PRODUCTION_PROVIDER_WIRING_MODEL_VERSION,
    capability: 'player_identity',
    selectedProvider: 'rolling_insights',
    fallbackChain: ['rolling_insights', 'api_sports', 'clearsports', 'canonical_cache'],
    attempts: [],
    canonicalData: { allFantasyPlayerId: 'player-1', displayName: 'Test Player' },
    mergedCanonicalData: { allFantasyPlayerId: 'player-1', displayName: 'Test Player' },
    conflicts: [],
    trace: {
      canonicalPlayerId: 'player-1',
      providerUsed: 'rolling_insights',
      timestampIso: '2026-09-13T18:03:00.000Z',
      sourceTimestampIso: '2026-09-13T18:00:00.000Z',
      freshnessStatus: 'available',
      fallbackUsed: false,
      cacheUsed: false,
      healthStatus: 'ACTIVE',
    },
    warnings: [],
    providerPayloadExposed: false,
    providerIdsExposedToCanonicalData: false,
  }
}

describe('G49I NFL redraft provider validation dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates the provider health dashboard shape and counts canonical evidence states', () => {
    const dashboard = buildNflRedraftProviderValidationDashboard({
      now: new Date('2026-09-13T18:05:00.000Z'),
      env: {},
      evidencePackets: [
        packet({ sourceProvider: 'rolling_insights' }),
        packet({ sourceProvider: 'api_sports', stale: true, fallback: true }),
        packet({ sourceProvider: 'openweather', missing: true, fallback: true }),
      ],
      recentResolutions: [resolution()],
      playerId: 'player-1',
      gameId: 'game-1',
    })

    expect(dashboard).toMatchObject({
      internalOnly: true,
      adminOnly: true,
      safeOutput: {
        rawProviderPayloadExposed: false,
        providerSecretsExposed: false,
      },
      evidenceCounts: {
        total: 3,
        stale: 1,
        missing: 1,
        fallback: 2,
      },
    })
    expect(dashboard.flow).toEqual([
      'provider',
      'orchestrator',
      'canonical_models',
      'evidence',
      'runtime_premium_services',
      'ui',
    ])
    expect(dashboard.providers).toHaveLength(8)
    expect(dashboard.providers.find((provider) => provider.providerId === 'rolling_insights')).toMatchObject({
      displayName: 'Rolling Insights',
      status: 'ACTIVE',
      counts: { evidencePackets: 1 },
    })
    expect(dashboard.providers.find((provider) => provider.providerId === 'api_sports')).toMatchObject({
      status: 'EXPIRED',
      counts: { staleEvidence: 1, fallbackEvidence: 1 },
    })
    expect(assertNflRedraftProviderValidationOutputSafe(dashboard)).toEqual({ ok: true, leakedTerms: [] })
  })

  it('builds player and game trace views without raw provider payload leakage', () => {
    const packets = [
      packet({ sourceProvider: 'rolling_insights', playerId: 'player-1', gameId: 'game-1' }),
      packet({ sourceProvider: 'api_sports', playerId: 'player-2', gameId: 'game-2', stale: true }),
    ]

    const playerTrace = buildNflRedraftCanonicalTraceView({
      traceType: 'player',
      canonicalId: 'player-1',
      evidencePackets: packets,
      recentResolutions: [resolution()],
    })
    const gameTrace = buildNflRedraftCanonicalTraceView({
      traceType: 'game',
      canonicalId: 'game-1',
      evidencePackets: packets,
    })

    expect(playerTrace).toMatchObject({
      found: true,
      providerUsed: 'rolling_insights',
      freshnessStatus: 'available',
      rawProviderPayloadExposed: false,
      providerSecretsExposed: false,
    })
    expect(playerTrace.evidencePacketIds).toHaveLength(1)
    expect(playerTrace.affectedSurfaces).toContain('matchup')
    expect(gameTrace).toMatchObject({
      found: true,
      providerUsed: 'rolling_insights',
      sourceTimestampIso: '2026-09-13T18:00:00.000Z',
    })
    expect(assertNflRedraftProviderValidationOutputSafe({ playerTrace, gameTrace })).toEqual({
      ok: true,
      leakedTerms: [],
    })
  })

  it('lists direct provider bypass audit entries with migration guidance', () => {
    const audit = listNflRedraftLegacyDirectProviderAudit()

    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routeOrFile: 'lib/player-assets/resolvePlayerHeadshot.ts',
          providerUsed: 'API-Sports, ClearSports',
          riskLevel: 'high',
          migrateNow: false,
        }),
        expect.objectContaining({
          routeOrFile: 'app/api/redraft/*',
          providerUsed: 'none found in focused G49I search',
          riskLevel: 'low',
        }),
      ]),
    )
    expect(audit.every((entry) => entry.suggestedCanonicalReplacement.includes('G49H'))).toBe(true)
  })

  it('enforces the admin-only route boundary before returning dashboard data', async () => {
    mockedRequireAdminOrBearer.mockResolvedValueOnce({
      ok: false,
      res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })
    const { GET } = await import('@/app/api/admin/redraft/provider-validation/route')

    const response = await GET(new Request('https://allfantasy.test/api/admin/redraft/provider-validation'))

    expect(response.status).toBe(401)
    expect(mockedLoadProductionEvidence).not.toHaveBeenCalled()
  })

  it('renders route-compatible provider health data from canonical production evidence only', async () => {
    mockedRequireAdminOrBearer.mockResolvedValueOnce({
      ok: true,
      user: { id: 'admin-1', role: 'admin' },
    })
    mockedLoadProductionEvidence.mockResolvedValueOnce([
      packet({ sourceProvider: 'rolling_insights', playerId: 'player-1', gameId: 'game-1' }),
    ])
    const { GET } = await import('@/app/api/admin/redraft/provider-validation/route')

    const response = await GET(
      new Request(
        'https://allfantasy.test/api/admin/redraft/provider-validation?leagueId=league-1&teamId=team-1&playerId=player-1&gameId=game-1&serviceId=basic_runtime_facts',
      ),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      route: '/api/admin/redraft/provider-validation',
      internalOnly: true,
      adminOnly: true,
      playerTrace: {
        found: true,
        canonicalId: 'player-1',
      },
      gameTrace: {
        found: true,
        canonicalId: 'game-1',
      },
    })
    expect(mockedLoadProductionEvidence).toHaveBeenCalledWith({
      serviceId: 'basic_runtime_facts',
      canonicalIds: {
        leagueId: 'league-1',
        teamId: 'team-1',
        managerId: null,
        matchupId: null,
        playerId: 'player-1',
        week: null,
        season: null,
      },
      ingestedAtIso: expect.any(String),
    })
    expect(assertNflRedraftProviderValidationOutputSafe(body)).toEqual({ ok: true, leakedTerms: [] })
  })
})
