// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The cross-league board priced on NEXT week's board, and the claim-week rule that decides when.
 * Board harness shape: __tests__/core-app/waivers-board-injured-candidates.test.ts.
 */

const h = vi.hoisted(() => ({
  ready: true,
  injuries: new Map<string, { status: string; stale: boolean }>(),
  readTopCalls: [] as Array<{ week: number; afterWeek: number }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  leagueTeam: { findMany: async () => [{
    leagueId: 'lg', externalId: '1', platformUserId: 'me',
    league: { id: 'lg', name: 'Test League', platform: 'manual', sport: 'NFL', settings: { roster_positions: ['WR', 'BN', 'BN'] }, platformLeagueId: 'SL', leagueType: 'redraft', scoring: 'ppr', logoUrl: null, avatarUrl: null },
  }] },
  roster: { findMany: async () => [{ leagueId: 'lg', platformUserId: 'me', faabRemaining: 100, playerData: { players: ['mywr', 'bench1'], starters: ['mywr'] } }] },
  leagueWaiverSettings: { findMany: async () => [] },
  sportsGame: { findMany: async () => [] },
  /* The week BEING PLAYED (4): "thisweek" is the best free agent. */
  fantasyProjection: { findMany: async () => [
    { playerId: 'thisweek', projectedPoints: 20, stats: { stats: { pts: 20 } } },
    { playerId: 'mywr', projectedPoints: 10, stats: { stats: { pts: 10 } } },
    { playerId: 'bench1', projectedPoints: 2, stats: { stats: { pts: 2 } } },
  ] },
  sportsPlayer: { findMany: async () => [
    { sleeperId: 'thisweek', source: 'sleeper', name: 'This Week Star', position: 'WR', team: 'KC', imageUrl: null },
    { sleeperId: 'nextweek', source: 'sleeper', name: 'Next Week Star', position: 'WR', team: 'SF', imageUrl: null },
    { sleeperId: 'outnow', source: 'sleeper', name: 'Out This Sunday', position: 'WR', team: 'DAL', imageUrl: null },
    { sleeperId: 'onir', source: 'sleeper', name: 'On IR', position: 'WR', team: 'NYG', imageUrl: null },
    { sleeperId: 'mywr', source: 'sleeper', name: 'My Receiver', position: 'WR', team: 'MIA', imageUrl: null },
    { sleeperId: 'bench1', source: 'sleeper', name: 'Bench Guy', position: 'WR', team: 'NYJ', imageUrl: null },
  ] },
} }))
vi.mock('@/lib/projections/leagueScoring', () => ({
  extractScoringSettings: () => ({ rec: 1 }),
  computeLeagueProjectedPoints: (c: { pts?: number } | null) => (c?.pts != null ? { points: c.pts } : null),
}))
vi.mock('@/lib/core-app/rosteredMarket', () => ({ MIN_LEAGUES_FOR_MARKET: 5, getRosteredMarket: async () => ({ leaguesCounted: 0, byPlayerId: new Map() }) }))
vi.mock('@/lib/core-app/playerProjections', () => ({
  latestProjectionWeek: async () => ({ season: '2026', week: 4 }),
  lookupAfEngineProjections: async () => new Map(),
  afEngineForLeague: () => null,
}))
vi.mock('@/lib/core-app/myRoster', () => ({ myRosterCandidates: () => ['me'] }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({
  resolveInjuryFacts: async () => ({ byPlayer: new Map([...h.injuries].map(([k, v]) => [k, { ...v }])) }),
}))
vi.mock('@/lib/projections/futureWeekProjectionStore', () => ({
  futureWeekProjectionsReady: async () => h.ready,
  futureWeekStoreReader: {
    readTopLines: async (input: { week: number; afterWeek: number }) => {
      h.readTopCalls.push({ week: input.week, afterWeek: input.afterWeek })
      /* Week 5, stored FLAT (the current feed nests the same line under stats.stats). */
      return [
        { playerId: 'onir', week: 5, projectedPoints: 30, stats: { pts: 30 } },
        { playerId: 'outnow', week: 5, projectedPoints: 25, stats: { pts: 25 } },
        { playerId: 'nextweek', week: 5, projectedPoints: 18, stats: { pts: 18 } },
        { playerId: 'mywr', week: 5, projectedPoints: 11, stats: { pts: 11 } },
        { playerId: 'bench1', week: 5, projectedPoints: 1, stats: { pts: 1 } },
      ]
    },
  },
}))

import { getWaiversBoard } from '@/lib/core-app/waiversBoard'
import { chooseClaimWeek, SPENT_SHARE } from '@/lib/core-app/waiverClaimWeek'
import { FUTURE_WEEK_STALE_MS } from '@/lib/projections/futureWeekProjections'

beforeEach(() => {
  h.ready = true
  h.injuries = new Map()
  h.readTopCalls = []
})

describe('getWaiversBoard — next week’s board', () => {
  it('CONTROL: with no claim week it prices the week being played', async () => {
    const b = await getWaiversBoard('me')
    expect(b.pricedOn).toBe('current_week')
    expect(b.at).toEqual({ season: '2026', week: 4 })
    expect(b.rows[0]?.add.name).toBe('This Week Star')
    expect(h.readTopCalls).toEqual([])
  })

  it('prices next week when asked for current + 1, reading the flat future line', async () => {
    h.injuries.set('on ir', { status: 'IR', stale: false })
    const b = await getWaiversBoard('me', { week: 5 })
    expect(b.pricedOn).toBe('next_week')
    expect(b.at).toEqual({ season: '2026', week: 5 })
    expect(h.readTopCalls).toEqual([{ week: 5, afterWeek: 4 }])
    /* "Out This Sunday" (25) beats "Next Week Star" (18): a game-day Out is this week's news. */
    expect(b.rows[0]?.add.name).toBe('Out This Sunday')
  })

  it('a game-day Out is eligible next week — but a season-scale ruling (IR) is not', async () => {
    h.injuries.set('on ir', { status: 'IR', stale: false })
    h.injuries.set('out this sunday', { status: 'Out', stale: false })
    const next = await getWaiversBoard('me', { week: 5 })
    expect(next.rows[0]?.add.name).toBe('Out This Sunday')
    expect(JSON.stringify(next.rows)).not.toContain('On IR')
  })

  it('never jumps further than next week', async () => {
    const b = await getWaiversBoard('me', { week: 7 })
    expect(b.pricedOn).toBe('current_week')
    expect(h.readTopCalls).toEqual([])
  })

  it('falls back to the week being played when next week’s tables are not there', async () => {
    h.ready = false
    const b = await getWaiversBoard('me', { week: 5 })
    expect(b.pricedOn).toBe('current_week')
    expect(b.at?.week).toBe(4)
  })
})

describe('chooseClaimWeek — which week a claim made now is for', () => {
  const current = { season: '2026', week: 4 }
  /* Eight fixtures; `played` of them kicked off before NOW. */
  const NOW = Date.UTC(2026, 9, 6, 12)
  const kickoffs = (played: number) =>
    Array.from({ length: 8 }, (_, i) => new Date(i < played ? NOW - (i + 1) * 3_600_000 : NOW + (i + 1) * 3_600_000).toISOString())
  const fresh = new Date(NOW - 3_600_000)

  it(`stays on the week being played until ${SPENT_SHARE * 100}% of it has kicked off`, () => {
    expect(chooseClaimWeek({ current, kickoffs: kickoffs(5), nextConfirmedAt: fresh, nowMs: NOW }).basis).toBe('current')
  })
  it('moves to next week once it has — when next week is published and fresh', () => {
    expect(chooseClaimWeek({ current, kickoffs: kickoffs(6), nextConfirmedAt: fresh, nowMs: NOW })).toEqual({
      season: '2026', week: 5, basis: 'next', currentWeek: 4,
    })
  })
  it('stays when next week is missing or its confirmation is stale (the import stopped reaching it)', () => {
    expect(chooseClaimWeek({ current, kickoffs: kickoffs(8), nextConfirmedAt: null, nowMs: NOW }).basis).toBe('current')
    const stale = new Date(NOW - FUTURE_WEEK_STALE_MS - 60_000)
    expect(chooseClaimWeek({ current, kickoffs: kickoffs(8), nextConfirmedAt: stale, nowMs: NOW }).basis).toBe('current')
  })
  it('stays when the schedule is unread — an unknown is not "the week is over"', () => {
    expect(chooseClaimWeek({ current, kickoffs: null, nextConfirmedAt: fresh, nowMs: NOW }).basis).toBe('current')
  })
})
