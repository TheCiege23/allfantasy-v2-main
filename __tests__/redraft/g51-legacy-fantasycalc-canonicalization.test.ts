import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  getCanonicalPlayerDirectory,
  getCanonicalPlayerValuations,
  getCanonicalValuationSnapshot,
  type FantasyCalcPlayer,
} from '@/lib/player-valuations/canonicalPlayerValuations'
import type { NflRedraftProductionProviderAdapter } from '@/lib/nfl-provider/nflRedraftProductionProviderWiring'

const root = resolve(__dirname, '../..')

function valuation(name: string, value: number): FantasyCalcPlayer {
  return {
    player: {
      id: value,
      name,
      mflId: '',
      sleeperId: `s-${value}`,
      position: 'WR',
      maybeBirthday: null,
      maybeHeight: null,
      maybeWeight: null,
      maybeCollege: null,
      maybeTeam: 'MIN',
      maybeAge: 25,
      maybeYoe: 3,
      espnId: null,
      fleaflickerId: null,
    },
    value,
    overallRank: 1,
    positionRank: 1,
    trend30Day: 10,
    redraftDynastyValueDifference: 0,
    redraftDynastyValuePercDifference: 0,
    redraftValue: value,
    combinedValue: value,
    maybeMovingStandardDeviation: null,
    maybeMovingStandardDeviationPerc: null,
    maybeMovingStandardDeviationAdjusted: null,
    displayTrend: true,
    maybeOwner: null,
    starter: true,
    maybeTier: 1,
    maybeAdp: 2,
    maybeTradeFrequency: 0.1,
  }
}

function adapter(
  providerId: 'fantasycalc' | 'canonical_cache',
  rows: FantasyCalcPlayer[],
  options: { cache?: boolean; stale?: boolean; fail?: boolean } = {},
): NflRedraftProductionProviderAdapter {
  return async (request) => {
    if (options.fail) throw new Error('provider unavailable')
    return {
      providerId,
      capability: request.capability,
      canonicalData: { valuationRecords: rows, rawProviderPayload: { forbidden: true } },
      sourceTimestampIso: '2026-07-12T04:00:00.000Z',
      fetchedAtIso: '2026-07-12T04:01:00.000Z',
      freshnessStatus: options.stale ? 'stale' : 'available',
      fallbackUsed: providerId === 'canonical_cache',
      cacheUsed: options.cache ?? false,
      healthStatus: options.stale ? 'DEGRADED' : 'ACTIVE',
      warnings: [],
      realIntegration: true,
      integrationName: `${providerId}:g51-test`,
    }
  }
}

describe('G51 legacy FantasyCalc path canonicalization', () => {
  it('routes list valuations through the provider orchestrator and returns normalized records', async () => {
    const rows = [valuation('Justin Jefferson', 9500)]
    const result = await getCanonicalPlayerValuations(undefined, {
      adapters: { fantasycalc: { fantasy_valuations: adapter('fantasycalc', rows) } },
    })
    expect(result).toEqual(rows)
    expect(JSON.stringify(result)).not.toContain('rawProviderPayload')
  })

  it('uses stale canonical cache when the preferred provider fails', async () => {
    const rows = [valuation('Cached Player', 7000)]
    const snapshot = await getCanonicalValuationSnapshot(undefined, {
      adapters: {
        fantasycalc: { fantasy_valuations: adapter('fantasycalc', [], { fail: true }) },
        canonical_cache: { fantasy_valuations: adapter('canonical_cache', rows, { cache: true, stale: true }) },
      },
    })
    expect(snapshot).toMatchObject({
      players: rows,
      source: 'canonical_cache',
      stale: true,
      fallbackUsed: true,
      cacheUsed: true,
    })
  })

  it('returns an explicit unavailable snapshot instead of fabricated valuations', async () => {
    const snapshot = await getCanonicalValuationSnapshot(undefined, {
      adapters: {
        fantasycalc: { fantasy_valuations: adapter('fantasycalc', [], { fail: true }) },
        canonical_cache: { fantasy_valuations: adapter('canonical_cache', [], { fail: true }) },
      },
      env: {},
    })
    expect(snapshot.players).toEqual([])
    expect(snapshot.source).toBe('unavailable')
  })

  it('derives the directory from canonical valuation records', async () => {
    const rows = [valuation('Player A', 1), valuation('Player B', 2), valuation('Player A duplicate', 1)]
    const directory = await getCanonicalPlayerDirectory(undefined, {
      adapters: { fantasycalc: { fantasy_valuations: adapter('fantasycalc', rows) } },
    })
    expect(directory).toHaveLength(2)
  })

  it('prevents runtime consumers from importing the provider client or DB cache directly', () => {
    const allowed = new Set([
      'lib/fantasycalc-db.ts',
      'lib/nfl-provider/nflRedraftProductionProviderWiring.ts',
      'lib/player-valuations/canonicalPlayerValuations.ts',
      'app/api/health/fantasycalc/route.ts',
    ])
    const violations: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry)
        const rel = relative(root, abs).replaceAll('\\', '/')
        if (entry === 'node_modules' || entry.startsWith('.next')) continue
        if (statSync(abs).isDirectory()) {
          walk(abs)
          continue
        }
        if (!/\.(?:ts|tsx)$/.test(entry) || allowed.has(rel)) continue
        const source = readFileSync(abs, 'utf8')
        if (source.includes("@/lib/fantasycalc") || source.includes("@/lib/fantasycalc-db") || /from ['"]\.\.?\/fantasycalc['"]/.test(source)) {
          violations.push(rel)
        }
      }
    }
    for (const directory of ['app', 'components', 'hooks', 'lib', 'server']) {
      const abs = join(root, directory)
      if (statSync(abs).isDirectory()) walk(abs)
    }
    expect(violations).toEqual([])
  })

  it('keeps public valuation responses provider-neutral', () => {
    const route = readFileSync(join(root, 'app/api/fantasycalc/route.ts'), 'utf8')
    expect(route).toContain('getCanonicalValuationSnapshot')
    expect(route).not.toContain('readFantasyCalcValuesFromDb')
    expect(route).not.toContain('getFantasyCalcValuesDbFirst')
  })
})
