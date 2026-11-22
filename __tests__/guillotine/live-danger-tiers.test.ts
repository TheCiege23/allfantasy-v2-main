/**
 * @vitest-environment node
 *
 * The live danger tiers (lib/guillotine/chopWatchLoad.ts getLiveDangerTiers) behind the war room, the
 * league dashboard, the weekly summary and the home extras: while a week is played they come from Chop
 * Watch, by the chop's own rules, not from the danger engine's ranking on last week's season totals.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ league: null as unknown, live: null as unknown }))

vi.mock('@/lib/prisma', () => {
  const model = new Proxy(
    {},
    { get: (_t, method: string) => async () => (method === 'findMany' ? [] : method === 'findUnique' ? state.league : null) },
  )
  return { prisma: new Proxy({}, { get: () => model }) }
})
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true, isCommissioner: false })) }))
vi.mock('@/lib/league/getEffectiveLeagueRosterTemplate', () => ({ getEffectiveLeagueRosterTemplate: vi.fn(async () => ({ template: { slots: [] } })) }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: vi.fn(async () => null) }))
vi.mock('@/lib/redraft-war-room/redraftFreeAgentPool', () => ({ fetchAdpByPlayerKey: vi.fn(async () => new Map()) }))
vi.mock('@/lib/redraft-war-room/redraftInjuryNews', () => ({
  fetchRedraftInjuryNews: vi.fn(async () => ({ injuryByName: new Map(), newsCount: 0, injuriesAsOf: null })),
  injuryNameKey: (n: string) => String(n ?? '').trim().toLowerCase(),
}))
vi.mock('@/lib/guillotine/chopPreviewLoad', () => ({ loadChopPreview: vi.fn() }))

import { chopWatchDangerRows, type ChopWatch } from '@/lib/guillotine/chopWatch'
import { getLiveDangerTiers } from '@/lib/guillotine/chopWatchLoad'

const WATCH: ChopWatch = {
  week: 6, chopCount: 1, chopLine: 71.4,
  // Lowest first, as the preview orders them.
  dangerTiers: [
    { rosterId: 'low', displayName: 'Low', tier: 'chop_zone', pointsFromChopZone: 0 },
    { rosterId: 'close', displayName: 'Close', tier: 'danger', pointsFromChopZone: 5.5 },
    { rosterId: 'top', displayName: 'Top', tier: 'safe', pointsFromChopZone: 59.8 },
  ],
  scores: { low: 71.4, close: 76.9, top: 131.2 },
  seasonPoints: { low: 402.1, close: 455, top: 610.3 },
}

describe('chopWatchDangerRows', () => {
  it('is the danger engine’s row shape: rank 1 the lowest, this week’s points, the season through it', () => {
    expect(chopWatchDangerRows(WATCH)).toEqual([
      { rosterId: 'low', displayName: 'Low', projectedPoints: 71.4, seasonPointsCumul: 402.1, tier: 'chop_zone', rank: 1, pointsFromChopZone: 0 },
      { rosterId: 'close', displayName: 'Close', projectedPoints: 76.9, seasonPointsCumul: 455, tier: 'danger', rank: 2, pointsFromChopZone: 5.5 },
      { rosterId: 'top', displayName: 'Top', projectedPoints: 131.2, seasonPointsCumul: 610.3, tier: 'safe', rank: 3, pointsFromChopZone: 59.8 },
    ])
  })
})

describe('getLiveDangerTiers', () => {
  const OLD = [{ rosterId: 'low', projectedPoints: 380, seasonPointsCumul: 380, tier: 'chop_zone' as const, rank: 1, pointsFromChopZone: 0 }]

  it('live when Chop Watch can build the week; the engine is not asked', async () => {
    const loadTiers = vi.fn(async () => OLD)
    const out = await getLiveDangerTiers({ leagueId: 'L', weekOrPeriod: 6 }, { loadWatch: async () => WATCH, loadTiers })
    expect(out.live).toBe(true)
    expect(out.rows.map((r) => [r.rosterId, r.rank, r.projectedPoints])).toEqual([['low', 1, 71.4], ['close', 2, 76.9], ['top', 3, 131.2]])
    expect(loadTiers).not.toHaveBeenCalled()
  })

  it('the engine’s tiers otherwise — a past week, no chop, no scores, or a failed build', async () => {
    for (const loadWatch of [async () => null, async () => { throw new Error('db') }]) {
      const out = await getLiveDangerTiers({ leagueId: 'L', weekOrPeriod: 6 }, { loadWatch, loadTiers: async () => OLD })
      expect(out).toEqual({ rows: OLD, live: false })
    }
  })
})

describe('the war room reads the live tiers', () => {
  beforeEach(() => {
    vi.resetModules()
    state.league = {
      sport: 'NBA', season: 2026, guillotineMode: true, leagueVariant: 'guillotine', settings: {},
      rosters: [
        { id: 'low', platformUserId: 'u-low', playerData: { players: [] }, faabRemaining: null },
        { id: 'close', platformUserId: 'u', playerData: { players: [] }, faabRemaining: null },
        { id: 'top', platformUserId: 'u-top', playerData: { players: [] }, faabRemaining: null },
      ],
      teams: [],
    }
  })

  async function standings(live: boolean) {
    vi.doMock('@/lib/guillotine/chopWatchLoad', () => ({
      getLiveDangerTiers: vi.fn(async () =>
        live
          ? { rows: chopWatchDangerRows(WATCH), live: true }
          // The engine's own rows: its projectedPoints is a season-total fallback, not this week's score.
          : { rows: [{ rosterId: 'low', projectedPoints: 380, seasonPointsCumul: 380, tier: 'chop_zone', rank: 1, pointsFromChopZone: 0 }], live: false },
      ),
    }))
    const { buildGuillotineWarRoomContext } = await import('@/lib/guillotine-war-room/guillotineWarRoomContext')
    const res = await buildGuillotineWarRoomContext({ leagueId: 'L', userId: 'u' })
    if (!res.ok) throw new Error(res.error)
    return res.context.standings
  }

  it('this week’s tiers, ranks and points — the score the chop has not saved yet', async () => {
    const rows = await standings(true)
    // Safest first.
    expect(rows.map((r) => [r.rosterId, r.tier, r.rank, r.periodPoints, r.seasonPointsCumul, r.pointsFromChopZone])).toEqual([
      ['top', 'safe', 3, 131.2, 610.3, 59.8],
      ['close', 'danger', 2, 76.9, 455, 5.5],
      ['low', 'chop_zone', 1, 71.4, 402.1, 0],
    ])
  })

  it('without a live week nothing invents a score: the engine’s season-total fallback is not this week’s points', async () => {
    const rows = await standings(false)
    expect(rows.find((r) => r.rosterId === 'low')).toMatchObject({ tier: 'chop_zone', periodPoints: null })
    expect(rows.every((r) => r.periodPoints === null)).toBe(true)
  })
})
