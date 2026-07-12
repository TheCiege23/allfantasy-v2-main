import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  normalizeNflGameState,
  normalizeNflInjuryRow,
  normalizeNflInjuryStatus,
  normalizeNflScoreRow,
} from '@/lib/nfl-provider/nflRedraftScoreInjuryCanonical'
import { resolveNflRedraftProductionProviderCapability } from '@/lib/nfl-provider/nflRedraftProductionProviderWiring'
import type {
  NflRedraftProductionProviderRequest,
  NflRedraftProductionProviderResolution,
} from '@/lib/nfl-provider/nflRedraftProductionProviderWiring'
import { syncNflRedraftCronCanonicalCache } from '@/lib/nfl-provider/nflRedraftCronCanonicalSync'

const root = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('G50 canonical score and injury ingestion', () => {
  it('normalizes scheduled, live, and final score rows without raw payload fields', () => {
    expect(normalizeNflGameState('Not Started')).toBe('scheduled')
    expect(normalizeNflGameState('3rd Quarter')).toBe('live')
    expect(normalizeNflGameState('Final')).toBe('final')
    const row = normalizeNflScoreRow({
      game: { id: 42, week: 'Week 3', date: { timestamp: 1789923600 }, status: { long: 'Final' } },
      league: { season: '2026' },
      teams: { home: { name: 'Kansas City Chiefs' }, away: { name: 'Las Vegas Raiders' } },
      scores: { home: { total: 27 }, away: { total: 17 } },
      rawProviderPayload: { secret: 'must-not-leak' },
    }, { fetchedAtIso: '2026-09-20T20:00:00.000Z' })
    expect(row).toMatchObject({
      providerGameRef: '42',
      season: 2026,
      week: 3,
      state: 'final',
      homeScore: 27,
      awayScore: 17,
    })
    expect(JSON.stringify(row)).not.toContain('rawProviderPayload')
  })

  it('rejects malformed score rows and preserves partial optional fields as null', () => {
    expect(normalizeNflScoreRow({ game: { id: 1 }, teams: {} })).toBeNull()
    expect(normalizeNflScoreRow({
      game: { id: 2, status: { short: 'NS' } },
      teams: { home: { name: 'BUF' }, away: { name: 'MIA' } },
      scores: {},
    })).toMatchObject({ state: 'scheduled', homeScore: null, awayScore: null })
  })

  it('normalizes injury labels, rejects nameless rows, and preserves identity confidence', () => {
    expect(normalizeNflInjuryStatus('Injured Reserve')).toBe('ir')
    expect(normalizeNflInjuryStatus('Game-Time Decision')).toBe('questionable')
    expect(normalizeNflInjuryStatus('unrecognized provider label')).toBe('unknown')
    expect(normalizeNflInjuryRow({ status: 'Out' })).toBeNull()
    expect(normalizeNflInjuryRow({
      player: { id: 99, name: 'Example Player' },
      team: { name: 'Buffalo Bills' },
      status: 'Questionable',
      type: 'Hamstring',
      description: 'Limited',
    }, { canonicalPlayerId: 'canonical-99' })).toMatchObject({
      canonicalPlayerId: 'canonical-99',
      providerPlayerRef: '99',
      team: 'BUF',
      status: 'questionable',
      confidence: 'resolved',
    })
  })

  it('falls back from failed score and injury providers to stale canonical cache', async () => {
    for (const capability of ['scores', 'injuries'] as const) {
      const result = await resolveNflRedraftProductionProviderCapability({
        capability,
        configOverrides: {
          rolling_insights: { state: 'FAILED' },
          api_sports: { state: 'FAILED' },
        },
      }, {
        adapters: {
          canonical_cache: {
            [capability]: async (request: NflRedraftProductionProviderRequest) => ({
              providerId: 'canonical_cache',
              capability: request.capability,
              canonicalData: capability === 'scores' ? { scores: [{ providerGameRef: 'cached' }] } : { injuries: [{ playerName: 'Cached Player' }] },
              sourceTimestampIso: '2026-09-20T17:00:00.000Z',
              fetchedAtIso: '2026-09-20T20:00:00.000Z',
              freshnessStatus: 'stale',
              fallbackUsed: true,
              cacheUsed: true,
              healthStatus: 'DEGRADED',
              warnings: ['stale canonical cache'],
              realIntegration: true,
              integrationName: 'test-cache',
            }),
          },
        },
      })
      expect(result.selectedProvider).toBe('canonical_cache')
      expect(result.trace).toMatchObject({ fallbackUsed: true, cacheUsed: true, freshnessStatus: 'stale' })
    }
  })

  it('writes canonical cache before invoking the read-model projector', async () => {
    const events: string[] = []
    const resolution: NflRedraftProductionProviderResolution = {
      modelVersion: 'nfl-redraft-production-provider-wiring-v1',
      capability: 'injuries' as const,
      selectedProvider: 'api_sports' as const,
      fallbackChain: ['rolling_insights', 'api_sports', 'canonical_cache', 'runtime'],
      attempts: [],
      canonicalData: { injuries: [{ playerName: 'Example Player' }] },
      mergedCanonicalData: {},
      conflicts: [],
      trace: {
        canonicalPlayerId: null,
        providerUsed: 'api_sports' as const,
        timestampIso: '2026-09-20T20:00:00.000Z',
        sourceTimestampIso: '2026-09-20T19:59:00.000Z',
        freshnessStatus: 'available' as const,
        fallbackUsed: true,
        cacheUsed: false,
        healthStatus: 'ACTIVE' as const,
      },
      warnings: [],
      providerPayloadExposed: false as const,
      providerIdsExposedToCanonicalData: false as const,
    }
    const upsert = vi.fn(async () => { events.push('cache') })
    const result = await syncNflRedraftCronCanonicalCache(
      { job: 'import-injuries', sport: 'NFL', season: 2026 },
      {
        now: () => new Date('2026-09-20T20:00:00.000Z'),
        prisma: { sportsDataCache: { upsert } },
        resolveProviderCapability: vi.fn(async () => resolution),
        afterCacheWrite: async () => { events.push('project') },
      },
    )
    expect(result).toMatchObject({ status: 'synced', capability: 'injuries' })
    expect(events).toEqual(['cache', 'project'])
  })

  it('guards customer-facing NFL score and injury ingestion from direct provider imports', () => {
    const scoreRoute = read('app/api/cron/import-scores/route.ts')
    const injuryRoute = read('app/api/cron/import-injuries/route.ts')
    const scheduleRoute = read('app/api/cron/import-schedules/route.ts')
    const adminSyncRoute = read('app/api/sports/sync/route.ts')
    for (const source of [scoreRoute, injuryRoute, scheduleRoute]) {
      expect(source).not.toContain('@/lib/api-sports')
    }
    for (const source of [scoreRoute, injuryRoute, scheduleRoute, adminSyncRoute]) {
      expect(source).not.toMatch(/syncAPISports(?:Games|Injuries)ToDb/)
      expect(source).toContain('syncNflRedraftCronCanonicalCache')
    }
    const ncaafCompatibility = read('lib/ncaaf-provider/legacyApiSportsIngestion.ts')
    expect(ncaafCompatibility).toContain("sport: 'NCAAF'")
    expect(ncaafCompatibility).not.toContain("sport: 'NFL'")
  })

  it('keeps native fantasy matchup results outside provider ingestion', () => {
    const scoreRoute = read('app/api/cron/import-scores/route.ts')
    const projector = read('lib/nfl-provider/nflRedraftCanonicalScoreInjuryProjector.ts')
    expect(scoreRoute).not.toMatch(/redraftMatchup\.(?:update|upsert|create)/)
    expect(projector).not.toContain('redraftMatchup')
    expect(projector).not.toContain('finalized fantasy')
  })
})
