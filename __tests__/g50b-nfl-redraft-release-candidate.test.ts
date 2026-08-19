import { describe, expect, it, vi } from 'vitest'
import {
  buildNflRedraftCronCanonicalCacheKey,
  buildNflRedraftReleaseCandidateReport,
  syncNflRedraftCronCanonicalCache,
  type NflRedraftProductionProviderResolution,
} from '@/lib/nfl-provider'

function resolution(capability: NflRedraftProductionProviderResolution['capability']): NflRedraftProductionProviderResolution {
  return {
    modelVersion: 'nfl-redraft-production-provider-wiring-v1',
    capability,
    selectedProvider: 'rolling_insights',
    fallbackChain: ['rolling_insights', 'runtime'],
    attempts: [
      {
        providerId: 'rolling_insights',
        state: 'ACTIVE',
        attempted: true,
        selected: true,
        cacheUsed: false,
        fallbackUsed: false,
        realIntegration: true,
        reason: 'selected',
        error: null,
      },
    ],
    canonicalData: {
      gameId: 'af-game-1',
      status: 'scheduled',
      rawProviderPayload: { shouldNotPersist: true },
      providerPlayerId: 'should-not-persist',
    },
    mergedCanonicalData: {
      gameId: 'af-game-1',
      status: 'scheduled',
    },
    conflicts: [],
    trace: {
      canonicalPlayerId: null,
      providerUsed: 'rolling_insights',
      timestampIso: '2026-09-13T20:00:00.000Z',
      sourceTimestampIso: '2026-09-13T19:59:00.000Z',
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

function safeText(value: unknown): string {
  return JSON.stringify(value)
    .toLowerCase()
    .replace(/rawproviderpayloadexposed":false/g, '')
    .replace(/providersecretsexposed":false/g, '')
}

describe('G50B NFL redraft release candidate RC1', () => {
  it('writes safe cron canonical cache for scores, schedules, and standings through the provider orchestrator', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const resolveProviderCapability = vi.fn(async (request) => resolution(request.capability))

    for (const job of ['import-scores', 'import-schedules', 'import-standings'] as const) {
      const result = await syncNflRedraftCronCanonicalCache(
        {
          job,
          sport: 'NFL',
          season: '2026',
          week: '1',
          ttlMs: 60_000,
        },
        {
          now: () => new Date('2026-09-13T20:00:00.000Z'),
          prisma: { sportsDataCache: { upsert } },
          resolveProviderCapability,
        },
      )

      expect(result).toMatchObject({
        modelVersion: 'nfl-redraft-cron-canonical-sync-v1',
        job,
        sport: 'NFL',
        status: 'synced',
        selectedProvider: 'rolling_insights',
        rawProviderPayloadExposed: false,
        providerSecretsExposed: false,
      })
      expect(result.cacheKey).toBe(buildNflRedraftCronCanonicalCacheKey({
        job,
        season: '2026',
        week: '1',
      }))
    }

    expect(upsert).toHaveBeenCalledTimes(3)
    const persisted = upsert.mock.calls[0][0].create.data
    expect(persisted).toMatchObject({
      modelVersion: 'nfl-redraft-cron-canonical-sync-v1',
      selectedProvider: 'rolling_insights',
      freshnessStatus: 'available',
    })
    expect(safeText(persisted)).not.toContain('rawproviderpayload')
    expect(safeText(persisted)).not.toContain('providerplayerid')
    expect(safeText(persisted)).not.toContain('api_key')
    expect(safeText(persisted)).not.toContain('client_secret')
  })

  it('defers injury cron canonical sync instead of inventing a provider capability', async () => {
    const result = await syncNflRedraftCronCanonicalCache({
      job: 'import-injuries',
      sport: 'NFL',
      season: '2026',
    })

    expect(result).toMatchObject({
      status: 'deferred',
      capability: null,
      cacheKey: null,
      deferredReason: 'missing_orchestrator_injury_capability',
    })
    expect(result.warnings.join(' ')).toContain('standalone injury capability')
  })

  it('skips non-NFL cron canonical sync because G50B is scoped to AF NFL Redraft only', async () => {
    const result = await syncNflRedraftCronCanonicalCache({
      job: 'import-scores',
      sport: 'NCAAF',
      season: '2026',
    })

    expect(result).toMatchObject({
      status: 'skipped',
      sport: 'NCAAF',
      deferredReason: 'non_nfl_sport',
    })
  })

  it('builds an RC1 checklist with resolved blockers, remaining blockers, and internal go recommendation', () => {
    const report = buildNflRedraftReleaseCandidateReport({
      generatedAtIso: '2026-09-13T21:00:00.000Z',
      cronResults: [
        {
          modelVersion: 'nfl-redraft-cron-canonical-sync-v1',
          job: 'import-scores',
          sport: 'NFL',
          season: '2026',
          week: '1',
          status: 'synced',
          capability: 'live_stats',
          cacheKey: 'nfl-redraft-provider:live_stats:2026:1:import-scores',
          selectedProvider: 'rolling_insights',
          providerFlow: ['provider', 'orchestrator', 'canonical_cache'],
          freshnessStatus: 'available',
          fallbackUsed: false,
          cacheUsed: false,
          expiresAtIso: '2026-09-13T21:05:00.000Z',
          warnings: [],
          deferredReason: null,
          rawProviderPayloadExposed: false,
          providerSecretsExposed: false,
        },
      ],
    })

    expect(report).toMatchObject({
      modelVersion: 'nfl-redraft-release-candidate-rc1-v1',
      factsOnly: true,
      scope: 'AF_NFL_REDRAFT_ONLY',
      goNoGoRecommendation: 'GO_FOR_RC1_INTERNAL',
      safeOutput: {
        rawProviderPayloadExposed: false,
        providerSecretsExposed: false,
        aiReasoningIncluded: false,
        recommendationsIncluded: false,
      },
    })
    expect(report.resolvedLaunchBlockers.join(' ')).toContain('canonical cron cache sync hook')
    expect(report.remainingLaunchBlockers.join(' ')).toContain('Playwright')
    expect(report.productionChecklist.map((item) => item.category)).toEqual([
      'build',
      'lint',
      'tests',
      'typescript',
      'provider_health',
      'premium_services',
      'canonical_cache',
      'evidence',
      'playwright',
      'accessibility',
      'performance',
      'dark_mode',
      'mobile',
      'admin',
      'import',
      'runtime',
    ])
    expect(report.productionReadinessPercent).toBeGreaterThanOrEqual(80)
    expect(safeText(report)).not.toContain('rawproviderpayload')
    expect(safeText(report)).not.toContain('client_secret')
    expect(safeText(report)).not.toContain('start this player')
  })
})
