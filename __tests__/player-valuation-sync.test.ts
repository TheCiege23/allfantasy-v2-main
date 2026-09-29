// @vitest-environment node
/**
 * The player-valuation writer, moved out of `scripts/sync-player-valuations.ts` into
 * `lib/player-valuation-sync.ts` (2026-09-29) so `/api/cron/adp-refresh` can schedule it.
 * Driven through injected deps — no provider, no database.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The real module imports these at load; stubbed so nothing reaches a provider or Prisma.
vi.mock('@/lib/workers/providers/rolling-insights', () => ({ rollingInsightsProvider: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  PLAYER_VALUATION_SPORTS,
  syncPlayerValuations,
  syncPlayerValuationsForSport,
  type PlayerValuationSyncDeps,
} from '@/lib/player-valuation-sync'

const players = [
  { id: 1, full_name: 'Josh Allen', position: 'QB', team: 'BUF', stats: { passing_yards: 4300 } },
  { id: 2, full_name: 'Fred Warner', position: 'LB', team: 'SF', stats: {} },
]

function fakeDeps(over: Partial<PlayerValuationSyncDeps> = {}): PlayerValuationSyncDeps & {
  writes: Array<{ sport: string; count: number; ttlMs?: number }>
} {
  const writes: Array<{ sport: string; count: number; ttlMs?: number }> = []
  return {
    writes,
    fetchProvider: vi.fn(async ({ dataType }: { dataType: string }) => ({
      data: dataType === 'players' ? players : [],
      fromCache: false,
    })) as never,
    writeValuations: vi.fn(async (sport: string, rows: unknown[], opts?: { ttlMs?: number }) => {
      writes.push({ sport, count: rows.length, ttlMs: opts?.ttlMs })
      return { cacheKey: `player-valuations:${sport}`, expiresAt: new Date(0), count: rows.length }
    }) as never,
    now: () => 1_000,
    ...over,
  }
}

describe('syncPlayerValuationsForSport', () => {
  it('computes a valuation per named player and writes them with the given TTL', async () => {
    const deps = fakeDeps()
    const n = await syncPlayerValuationsForSport('nfl', 123, deps)
    expect(n).toBe(2)
    expect(deps.writes).toEqual([{ sport: 'nfl', count: 2, ttlMs: 123 }])
  })

  it('writes nothing when the provider returns no players', async () => {
    const deps = fakeDeps({ fetchProvider: vi.fn(async () => ({ data: [], fromCache: false })) as never })
    expect(await syncPlayerValuationsForSport('nba', 1, deps)).toBe(0)
    expect(deps.writes).toEqual([])
  })
})

describe('syncPlayerValuations', () => {
  it('defaults to all seven sports', async () => {
    const deps = fakeDeps()
    const summary = await syncPlayerValuations({}, deps)
    expect(deps.writes.map((w) => w.sport)).toEqual(PLAYER_VALUATION_SPORTS)
    expect(summary.total).toBe(2 * PLAYER_VALUATION_SPORTS.length)
  })

  it('isolates a failing sport — the next still runs — and redacts the recorded error', async () => {
    const deps = fakeDeps({
      fetchProvider: vi.fn(async ({ sport, dataType }: { sport: string; dataType: string }) => {
        if (sport === 'nba') throw new Error('fetch https://x/api?RSC_token=supersecret 500')
        return { data: dataType === 'players' ? players : [], fromCache: false }
      }) as never,
    })
    const summary = await syncPlayerValuations({ sports: ['nfl', 'nba', 'mlb'] }, deps)
    expect(Object.keys(summary.written)).toEqual(['nfl', 'mlb'])
    expect(summary.failed.nba).toContain('RSC_token=***')
    expect(summary.failed.nba).not.toContain('supersecret')
  })

  it('does not START a sport once the deadline has passed', async () => {
    let t = 0
    const deps = fakeDeps({ now: () => t })
    const write = deps.writeValuations as unknown as ReturnType<typeof vi.fn>
    write.mockImplementation(async (sport: string, rows: unknown[]) => {
      t += 60 // each sport "takes" 60ms
      return { cacheKey: sport, expiresAt: new Date(0), count: rows.length }
    })
    const summary = await syncPlayerValuations({ sports: ['nfl', 'nba', 'mlb'], deadlineAt: 100 }, deps)
    expect(Object.keys(summary.written)).toEqual(['nfl', 'nba'])
    expect(summary.skipped).toEqual(['mlb'])
  })
})

describe('the npm script is a thin CLI over the same writer', () => {
  it('calls the lib writer and no longer calls the provider itself', () => {
    const src = readFileSync(resolve(process.cwd(), 'scripts/sync-player-valuations.ts'), 'utf8')
    expect(src).toContain("from '@/lib/player-valuation-sync'")
    expect(src).not.toContain('rollingInsightsProvider')
    expect(src).not.toContain('writePlayerValuationsToDb')
  })
})
