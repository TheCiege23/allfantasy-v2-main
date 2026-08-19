/**
 * Phase 1 — RI player-stats -> FantasyStatLine ingest.
 *
 * The behaviours under test are the brief's stated risks:
 *   - the ID namespace: canonical PlayerIdentityMap ids only, ambiguity
 *     REFUSED, unresolved rows skipped and COUNTED (never written keyed to a
 *     provider id that joins to nothing)
 *   - the season bootstrap: 2026 pre-kickoff (HTTP 304) falls back to 2025,
 *     explicitly recorded; an explicit season NEVER falls back
 *   - honesty: fantasyPointsByScoringPreset written as {} — scoring is Phase
 *     2/4's job; zero rows is a failure state, not a quiet success
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  identityFindMany: vi.fn(),
  identityUpdateMany: vi.fn(),
  statLineUpsert: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: { findMany: mocks.identityFindMany, updateMany: mocks.identityUpdateMany },
    fantasyStatLine: { upsert: mocks.statLineUpsert },
  },
}))

import {
  SEASON_AGGREGATE_WEEK,
  normalizeRiPlayerInfo,
  normalizeRiPlayerStats,
  syncRollingInsightsPlayerStatsToDb,
} from '@/lib/stats/rollingInsightsPlayerStats'

const NOW = new Date('2026-08-10T12:00:00Z') // month >= 8 -> current season 2026

function statsPayload(rows: unknown[]) {
  return { data: { NFL: rows } }
}

function riRow(over: Record<string, unknown> = {}) {
  return {
    player_id: 'ri-1',
    player: 'Josh Allen',
    team: 'Buffalo Bills',
    team_id: 4,
    regular_season: { passing_yards: 4300, passing_touchdowns: 32 },
    postseason: null,
    ...over,
  }
}

function identity(over: Record<string, unknown> = {}) {
  return {
    id: 'canon-1',
    canonicalName: 'Josh Allen',
    position: 'QB',
    currentTeam: 'BUF',
    rollingInsightsId: null,
    ...over,
  }
}

/** fetchImpl returning per-URL responses. */
function fetchFor(routes: Array<{ match: string; status?: number; body?: unknown }>) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    const route = routes.find((r) => u.includes(r.match))
    if (!route) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    const status = route.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body ?? {},
    } as unknown as Response
  }) as unknown as typeof fetch
}

describe('normalizeRiPlayerStats', () => {
  it('flattens {data:{NFL:[...]}}, dedups by player_id, drops rows without id or name', () => {
    const rows = normalizeRiPlayerStats(
      statsPayload([riRow(), riRow(), riRow({ player_id: '', player: 'No Id' }), riRow({ player_id: 'ri-2', player: '' })]),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ providerPlayerId: 'ri-1', playerName: 'Josh Allen', teamName: 'Buffalo Bills' })
    expect(rows[0].regularSeason).toMatchObject({ passing_yards: 4300 })
  })
})

describe('normalizeRiPlayerInfo', () => {
  it('maps player_id -> position/team, tolerating pos/team_name field drift', () => {
    const map = normalizeRiPlayerInfo(
      statsPayload([
        { player_id: 'ri-1', player: 'A', position: 'QB', team: 'Buffalo Bills' },
        { player_id: 'ri-2', player: 'B', pos: 'LB', team_name: 'Jacksonville Jaguars' },
      ]),
    )
    expect(map.get('ri-1')).toEqual({ position: 'QB', teamName: 'Buffalo Bills' })
    expect(map.get('ri-2')).toEqual({ position: 'LB', teamName: 'Jacksonville Jaguars' })
  })
})

describe('syncRollingInsightsPlayerStatsToDb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ROLLING_INSIGHTS_RSC_TOKEN = 'test-token'
    mocks.identityUpdateMany.mockResolvedValue({ count: 1 })
    mocks.statLineUpsert.mockResolvedValue({})
  })

  it('writes canonical ids with week 0, source rolling_insights, and EMPTY scoring presets', async () => {
    mocks.identityFindMany.mockResolvedValue([identity()])
    const res = await syncRollingInsightsPlayerStatsToDb({
      now: NOW,
      fetchImpl: fetchFor([
        { match: 'player-stats/2026', body: statsPayload([riRow()]) },
        { match: 'player-info', body: statsPayload([{ player_id: 'ri-1', position: 'QB', team: 'Buffalo Bills' }]) },
      ]),
    })
    expect(res.written).toBe(1)
    const call = mocks.statLineUpsert.mock.calls[0][0]
    expect(call.where.uniq_fantasy_stat_line_player_week_source).toMatchObject({
      playerId: 'canon-1',
      sport: 'NFL',
      season: '2026',
      week: SEASON_AGGREGATE_WEEK,
      source: 'rolling_insights',
    })
    expect(call.create.fantasyPointsByScoringPreset).toEqual({})
    expect(call.create.stats.regular_season).toMatchObject({ passing_yards: 4300 })
  })

  it('falls back to the prior season on HTTP 304 and records it explicitly', async () => {
    mocks.identityFindMany.mockResolvedValue([identity()])
    const res = await syncRollingInsightsPlayerStatsToDb({
      now: NOW,
      fetchImpl: fetchFor([
        { match: 'player-stats/2026', status: 304 },
        { match: 'player-stats/2025', body: statsPayload([riRow()]) },
        { match: 'player-info', body: statsPayload([]) },
      ]),
    })
    expect(res.seasonRequested).toBe(2026)
    expect(res.seasonUsed).toBe(2025)
    expect(res.seasonFellBack).toBe(true)
    expect(res.written).toBe(1)
    expect(mocks.statLineUpsert.mock.calls[0][0].where.uniq_fantasy_stat_line_player_week_source.season).toBe('2025')
  })

  it('an EXPLICIT season never falls back — you asked for it, you get it or a loud zero', async () => {
    mocks.identityFindMany.mockResolvedValue([identity()])
    const res = await syncRollingInsightsPlayerStatsToDb({
      season: 2026,
      now: NOW,
      fetchImpl: fetchFor([
        { match: 'player-stats/2026', status: 304 },
        { match: 'player-stats/2025', body: statsPayload([riRow()]) },
      ]),
    })
    expect(res.written).toBe(0)
    expect(res.seasonUsed).toBeNull()
    expect(res.errors.join(' ')).toContain('season not started')
  })

  it('REFUSES an ambiguous name collision instead of binding by map order', async () => {
    // QB Josh Allen vs LB Josh Allen; no player-info position available -> cannot split.
    mocks.identityFindMany.mockResolvedValue([
      identity({ id: 'canon-qb', position: 'QB', currentTeam: 'BUF' }),
      identity({ id: 'canon-lb', position: 'LB', currentTeam: 'JAX' }),
    ])
    const res = await syncRollingInsightsPlayerStatsToDb({
      now: NOW,
      fetchImpl: fetchFor([
        { match: 'player-stats/2026', body: statsPayload([riRow({ team: '' })]) },
        { match: 'player-info', body: statsPayload([]) },
      ]),
    })
    expect(res.written).toBe(0)
    expect(res.ambiguous).toBe(1)
    expect(res.sampleUnresolved[0]).toContain('AMBIGUOUS')
    expect(mocks.statLineUpsert).not.toHaveBeenCalled()
  })

  it('splits the same collision when player-info supplies a position', async () => {
    mocks.identityFindMany.mockResolvedValue([
      identity({ id: 'canon-qb', position: 'QB', currentTeam: 'BUF' }),
      identity({ id: 'canon-lb', position: 'LB', currentTeam: 'JAX' }),
    ])
    const res = await syncRollingInsightsPlayerStatsToDb({
      now: NOW,
      fetchImpl: fetchFor([
        { match: 'player-stats/2026', body: statsPayload([riRow({ team: 'Jacksonville Jaguars' })]) },
        { match: 'player-info', body: statsPayload([{ player_id: 'ri-1', position: 'LB', team: 'Jacksonville Jaguars' }]) },
      ]),
    })
    expect(res.written).toBe(1)
    expect(mocks.statLineUpsert.mock.calls[0][0].where.uniq_fantasy_stat_line_player_week_source.playerId).toBe('canon-lb')
  })

  it('unresolved players are SKIPPED and counted — never written under a provider id', async () => {
    mocks.identityFindMany.mockResolvedValue([identity({ canonicalName: 'Somebody Else' })])
    const res = await syncRollingInsightsPlayerStatsToDb({
      now: NOW,
      fetchImpl: fetchFor([
        { match: 'player-stats/2026', body: statsPayload([riRow()]) },
        { match: 'player-info', body: statsPayload([]) },
      ]),
    })
    expect(res.written).toBe(0)
    expect(res.unresolved).toBe(1)
    expect(res.unresolvedRate).toBe(1)
    expect(mocks.statLineUpsert).not.toHaveBeenCalled()
  })

  it('a direct rollingInsightsId hit wins without name matching, and is not re-backfilled', async () => {
    mocks.identityFindMany.mockResolvedValue([identity({ rollingInsightsId: 'ri-1' })])
    const res = await syncRollingInsightsPlayerStatsToDb({
      now: NOW,
      fetchImpl: fetchFor([
        { match: 'player-stats/2026', body: statsPayload([riRow({ player: 'Totally Different Display Name' })]) },
        { match: 'player-info', body: statsPayload([]) },
      ]),
    })
    expect(res.resolvedDirect).toBe(1)
    expect(res.written).toBe(1)
    expect(mocks.identityUpdateMany).not.toHaveBeenCalled()
  })

  it('backfills rollingInsightsId on a confident name match so future runs resolve directly', async () => {
    mocks.identityFindMany.mockResolvedValue([identity()])
    const res = await syncRollingInsightsPlayerStatsToDb({
      now: NOW,
      fetchImpl: fetchFor([
        { match: 'player-stats/2026', body: statsPayload([riRow()]) },
        { match: 'player-info', body: statsPayload([]) },
      ]),
    })
    expect(res.resolvedByName).toBe(1)
    expect(res.backfilledIds).toBe(1)
    expect(mocks.identityUpdateMany).toHaveBeenCalledWith({
      where: { id: 'canon-1', rollingInsightsId: null },
      data: { rollingInsightsId: 'ri-1' },
    })
  })

  it('refuses to write anything when the identity map is empty — provider-keyed rows join to nothing', async () => {
    mocks.identityFindMany.mockResolvedValue([])
    const res = await syncRollingInsightsPlayerStatsToDb({
      now: NOW,
      fetchImpl: fetchFor([{ match: 'player-stats/2026', body: statsPayload([riRow()]) }]),
    })
    expect(res.written).toBe(0)
    expect(res.errors.join(' ')).toContain('identity map empty')
  })

  it('degrades with errors, not a throw, when the provider is unreachable', async () => {
    mocks.identityFindMany.mockResolvedValue([identity()])
    const res = await syncRollingInsightsPlayerStatsToDb({
      now: NOW,
      fetchImpl: (async () => {
        throw new Error('network down')
      }) as unknown as typeof fetch,
    })
    expect(res.written).toBe(0)
    expect(res.errors.length).toBeGreaterThan(0)
  })
})
