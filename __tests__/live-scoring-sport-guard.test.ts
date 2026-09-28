/**
 * The live tick must only score seasons whose sport the live provider serves.
 *
 * It used to run every active season through the NFL provider, whatever its sport. An NHL
 * roster's ids are Rolling Insights ids, and 64% of NHL pool ids equal some NFL player's Sleeper
 * id (measured on production 2026-09-24), so an NHL player could be credited with an NFL player's
 * stat line and `player_weekly_scores` overwritten. See liveProviderServesSport.
 */
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { liveProviderServesSport, type LiveStatsProvider } from '@/lib/live-scoring/provider'
import { NflLiveStatsProvider } from '@/lib/live-scoring/nflLiveStatsProvider'
import { RollingInsightsLiveProvider } from '@/lib/live/rollingInsightsLiveProvider'
import {
  runLiveScoringForActiveSeasons,
  runLiveScoringTickForSeason,
} from '@/server/services/liveScoring/liveScoreRunner'

const SEASONS = [
  { id: 's-nhl', leagueId: 'l-nhl', sport: 'NHL', season: 2026, currentWeek: 1 },
  { id: 's-ncaab', leagueId: 'l-ncaab', sport: 'NCAAB', season: 2026, currentWeek: 1 },
  { id: 's-nfl', leagueId: 'l-nfl', sport: 'NFL', season: 2026, currentWeek: 3 },
]

/** Every model, every method: an empty read. Records any write so the test can assert none happened. */
function fakePrisma(writes: string[]) {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => async () => {
          if (/^(create|update|upsert|delete)/.test(method)) writes.push(`${name}.${method}`)
          if (name === 'redraftSeason' && method === 'findMany') return SEASONS
          if (method.startsWith('find') && method !== 'findMany') return null
          if (method === 'count') return 0
          return []
        },
      },
    )
  return new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === '$transaction') return async (x: unknown) => (typeof x === 'function' ? x({}) : x)
        if (prop === '$queryRaw' || prop === '$queryRawUnsafe') return async () => []
        return model(prop)
      },
    },
  ) as unknown as PrismaClient
}

function spyProvider(sports?: readonly string[]): LiveStatsProvider & { fetchActiveGames: ReturnType<typeof vi.fn> } {
  return {
    ...(sports ? { sports } : {}),
    fetchActiveGames: vi.fn(async () => []),
    fetchPlayerStatsForGames: vi.fn(async () => ({})),
    fetchTeamDefenseStatsForGames: vi.fn(async () => ({})),
    normalizeGameStatus: vi.fn(() => 'scheduled' as const),
  } as never
}

describe('liveProviderServesSport', () => {
  it('treats a provider that declares nothing as NFL only — fail closed, never open', () => {
    const p = spyProvider()
    expect(liveProviderServesSport(p, 'NFL')).toBe(true)
    for (const s of ['NHL', 'NBA', 'MLB', 'NCAAB', 'NCAAF', '', null, undefined]) {
      expect(liveProviderServesSport(p, s)).toBe(false)
    }
  })

  it('honours a declared list, case-insensitively on the season side', () => {
    const p = spyProvider(['NHL'])
    expect(liveProviderServesSport(p, 'nhl')).toBe(true)
    expect(liveProviderServesSport(p, 'NFL')).toBe(false)
  })

  it('both shipped providers serve NFL and only NFL', () => {
    const db = fakePrisma([])
    for (const p of [new NflLiveStatsProvider(db), new RollingInsightsLiveProvider(db as never)]) {
      expect(['NFL', 'NHL', 'NBA', 'MLB', 'NCAAB', 'NCAAF'].filter((s) => liveProviderServesSport(p, s))).toEqual(['NFL'])
    }
  })
})

describe('runLiveScoringForActiveSeasons', () => {
  it('never hands an NHL or NCAAB season to the NFL provider, and records why', async () => {
    const writes: string[] = []
    const provider = spyProvider(['NFL'])
    const r = await runLiveScoringForActiveSeasons(fakePrisma(writes), {
      provider,
      broadcast: () => {},
      now: new Date('2026-09-24T18:00:00Z'),
    })

    const sportsAsked = provider.fetchActiveGames.mock.calls.map((c) => (c[0] as { sport: string }).sport)
    expect(sportsAsked).toEqual(['NFL'])
    expect(provider.fetchPlayerStatsForGames).not.toHaveBeenCalled()
    expect(writes).toEqual([])

    const bySeason = Object.fromEntries(r.summaries.map((s) => [s.seasonId, s]))
    for (const id of ['s-nhl', 's-ncaab']) {
      expect(bySeason[id].polled).toBe(false)
      expect(bySeason[id].slateSource).toBe('not-live-scored')
      expect(bySeason[id].reason).toMatch(/^sport_not_live_scored: (NHL|NCAAB) /)
    }
    // The NFL season still ran the real tick (it resolved a slate rather than being skipped).
    expect(bySeason['s-nfl'].slateSource).not.toBe('not-live-scored')
    expect(bySeason['s-nfl'].reason).not.toMatch(/^(sport_not_live_scored|error)/)
    // A skipped season is reported, not counted as ticked.
    expect(r.summaries).toHaveLength(3)
    expect(r.ticked).toBe(1)
  })

  it('would tick an NHL season for a provider that declares NHL', async () => {
    const provider = spyProvider(['NHL'])
    await runLiveScoringForActiveSeasons(fakePrisma([]), { provider, broadcast: () => {}, now: new Date('2026-09-24T18:00:00Z') })
    const sportsAsked = provider.fetchActiveGames.mock.calls.map((c) => (c[0] as { sport: string }).sport)
    expect(sportsAsked).toEqual(['NHL'])
  })
})

describe('runLiveScoringTickForSeason', () => {
  it('refuses a direct call for a sport the provider does not serve, before touching the provider', async () => {
    const provider = spyProvider(['NFL'])
    await expect(
      runLiveScoringTickForSeason(fakePrisma([]), SEASONS[0], { provider, broadcast: () => {} }),
    ).rejects.toThrow(/does not serve NHL/)
    expect(provider.fetchActiveGames).not.toHaveBeenCalled()
  })
})
