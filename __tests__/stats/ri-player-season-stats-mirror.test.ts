/**
 * RI season rows for MLB/NBA/NHL are ALSO written to `player_season_stats`, keyed on RI's own id.
 *
 * 🛑 Measured 2026-10-17: the redraft roster, the player card and Player Finder read
 * `player_season_stats` WHERE source = 'rolling_insights' for any sport, and that table held RI rows
 * for NFL only — while this module wrote the same feed for MLB/NBA/NHL to `fantasy_stat_lines`, which
 * none of them read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  identityFindMany: vi.fn(),
  identityUpdateMany: vi.fn(),
  statLineUpsert: vi.fn(),
  executeRaw: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: { findMany: mocks.identityFindMany, updateMany: mocks.identityUpdateMany },
    fantasyStatLine: { upsert: mocks.statLineUpsert },
    $executeRaw: mocks.executeRaw,
  },
}))

import {
  PLAYER_SEASON_STATS_MIRROR_SPORTS,
  buildPlayerSeasonStatsMirrorValues,
  flattenRiSeasonStats,
  syncRollingInsightsPlayerStatsToDb,
} from '@/lib/stats/rollingInsightsPlayerStats'

const NOW = new Date('2026-10-17T12:00:00Z')

function fetchFor(routes: Array<{ match: string; status?: number; body?: unknown }>) {
  return vi.fn(async (url: string | URL | Request) => {
    const route = routes.find((r) => String(url).includes(r.match))
    if (!route) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    const status = route.status ?? 200
    return { ok: status >= 200 && status < 300, status, json: async () => route.body ?? {} } as unknown as Response
  }) as unknown as typeof fetch
}

// Real stored shape (fantasy_stat_lines, 2026-10-17): MLB groups batting under its own object.
const mlbRow = {
  player_id: '5501',
  player: 'Aaron Judge',
  team: 'New York Yankees',
  regular_season: { games_played: 152, E: 2, PO: 280, batting: { hits: 180, home_runs: 53 } },
}

/** Every value bound into the batched INSERT, flattened, so a test can find what was written. */
function boundValues(): unknown[] {
  const out: unknown[] = []
  const walk = (v: unknown) => {
    if (v && typeof v === 'object' && 'values' in (v as object)) {
      for (const x of (v as { values: unknown[] }).values) walk(x)
    } else out.push(v)
  }
  for (const call of mocks.executeRaw.mock.calls) for (const arg of call.slice(1)) walk(arg)
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ROLLING_INSIGHTS_RSC_TOKEN = 'test-token'
  mocks.identityFindMany.mockResolvedValue([])
  mocks.executeRaw.mockImplementation(async () => 1)
})

describe('flattenRiSeasonStats', () => {
  it('keeps scalars and qualifies a nested group instead of merging it', () => {
    expect(flattenRiSeasonStats(mlbRow.regular_season)).toEqual({
      games_played: 152,
      E: 2,
      PO: 280,
      'batting.hits': 180,
      'batting.home_runs': 53,
    })
  })

  it('leaves a flat NBA/NHL map untouched and drops arrays', () => {
    expect(flattenRiSeasonStats({ points: 2100, games_played: 70, splits: [1, 2] })).toEqual({ points: 2100, games_played: 70 })
  })
})

describe('buildPlayerSeasonStatsMirrorValues', () => {
  it('keys on the RI id with the season used, position from player-info, and no fantasy points', () => {
    const [v] = buildPlayerSeasonStatsMirrorValues({
      season: 2026,
      rows: [{ providerPlayerId: '5501', playerName: 'Aaron Judge', teamName: 'New York Yankees', teamId: null, regularSeason: mlbRow.regular_season, postseason: null }],
      infoById: new Map([['5501', { position: 'RF', teamName: null }]]),
    })
    expect(v).toMatchObject({ playerId: '5501', season: '2026', position: 'RF', team: 'New York Yankees', gamesPlayed: 152 })
    expect(v).not.toHaveProperty('fantasyPoints')
  })

  it('skips a row with no regular-season stats rather than writing an empty line', () => {
    expect(
      buildPlayerSeasonStatsMirrorValues({
        season: 2026,
        rows: [{ providerPlayerId: '1', playerName: 'X', teamName: null, teamId: null, regularSeason: {}, postseason: null }],
        infoById: new Map(),
      }),
    ).toEqual([])
  })
})

describe('syncRollingInsightsPlayerStatsToDb → player_season_stats', () => {
  it('scope is exactly MLB, NBA, NHL — not NFL (own writer) and not NCAAB (GAPS N-14)', () => {
    expect([...PLAYER_SEASON_STATS_MIRROR_SPORTS].sort()).toEqual(['MLB', 'NBA', 'NHL'])
  })

  it('writes MLB rows even when the identity map is empty for the sport', async () => {
    const res = await syncRollingInsightsPlayerStatsToDb({
      sport: 'MLB',
      now: NOW,
      fetchImpl: fetchFor([
        { match: 'player-stats/2026/MLB', body: { data: { MLB: [mlbRow] } } },
        { match: 'player-info/MLB', body: { data: { MLB: [{ player_id: '5501', position: 'RF' }] } } },
      ]),
    })
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1)
    expect(res.seasonStatsWritten).toBe(1)
    const bound = boundValues()
    expect(bound).toContain('5501')
    expect(bound).toContain('2026')
    expect(bound).toContain('rolling_insights')
    expect(bound.some((b) => typeof b === 'string' && b.includes('"batting.hits":180'))).toBe(true)
    // The fantasy_stat_lines path still refuses without identities — unchanged behaviour.
    expect(mocks.statLineUpsert).not.toHaveBeenCalled()
  })

  it('labels NBA rows with the season that actually answered (2026 304 -> 2025)', async () => {
    const res = await syncRollingInsightsPlayerStatsToDb({
      sport: 'NBA',
      now: NOW,
      fetchImpl: fetchFor([
        { match: 'player-stats/2026/NBA', status: 304 },
        { match: 'player-stats/2025/NBA', body: { data: { NBA: [{ player_id: '9', player: 'Jalen Brunson', team: 'New York Knicks', regular_season: { points: 2000, games_played: 74 } }] } } },
        { match: 'player-info/NBA', body: { data: { NBA: [] } } },
      ]),
    })
    expect(res.seasonUsed).toBe(2025)
    expect(boundValues()).toContain('2025')
    expect(boundValues()).not.toContain('2026')
  })

  it.each(['NFL', 'NCAAB'])('never writes %s to player_season_stats', async (sport) => {
    const code = sport === 'NCAAB' ? 'NCAABB' : sport
    const res = await syncRollingInsightsPlayerStatsToDb({
      sport,
      now: NOW,
      fetchImpl: fetchFor([
        { match: `player-stats/2026/${code}`, body: { data: { [code]: [{ ...mlbRow, regular_season: { games_played: 10 } }] } } },
        { match: `player-info/${code}`, body: { data: { [code]: [] } } },
      ]),
    })
    // The row really arrived — otherwise "not written" would hold for the wrong reason.
    expect(res.fetched).toBe(1)
    expect(mocks.executeRaw).not.toHaveBeenCalled()
  })

  it('a failed batch is reported, not thrown, and the stat-line path still runs', async () => {
    mocks.executeRaw.mockRejectedValueOnce(new Error('boom'))
    mocks.identityFindMany.mockResolvedValue([
      { id: 'c1', canonicalName: 'Aaron Judge', position: 'RF', currentTeam: 'New York Yankees', rollingInsightsId: '5501' },
    ])
    mocks.statLineUpsert.mockResolvedValue({})
    const res = await syncRollingInsightsPlayerStatsToDb({
      sport: 'MLB',
      now: NOW,
      fetchImpl: fetchFor([
        { match: 'player-stats/2026/MLB', body: { data: { MLB: [mlbRow] } } },
        { match: 'player-info/MLB', body: { data: { MLB: [] } } },
      ]),
    })
    expect(res.seasonStatsWritten).toBe(0)
    expect(res.errors.some((e) => e.includes('season-stats batch 0'))).toBe(true)
    expect(res.written).toBe(1)
  })
})
