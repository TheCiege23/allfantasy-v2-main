// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The waiver board names the best unrostered projection — and had no position check. On 2026-09-29
 * Chimmy's Tuesday waiver digest told the App Review account to "add Michael Tarquin (OT, Carolina
 * Panthers)" at +12.4 projected points. No league starts an offensive tackle, and a league with no
 * kicker slot cannot start a kicker either.
 */
const h = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  leagueTeam: { findMany: async () => [{
    leagueId: 'lg', externalId: '1', platformUserId: 'me',
    league: { id: 'lg', name: 'Test League', platform: 'sleeper', sport: 'NFL', settings: h.settings, platformLeagueId: 'SL', leagueType: 'redraft', scoring: 'ppr', logoUrl: null, avatarUrl: null },
  }] },
  roster: { findMany: async () => [{ leagueId: 'lg', platformUserId: 'me', faabRemaining: 100, playerData: { players: ['bench1', 'starter1'], starters: ['starter1'] } }] },
  leagueWaiverSettings: { findMany: async () => [] },
  sportsGame: { findMany: async () => [] },
  fantasyProjection: { findMany: async () => [
    { playerId: 'tackle', projectedPoints: 30.0, stats: { stats: { pts: 30.0 } } },
    { playerId: 'kicker', projectedPoints: 25.0, stats: { stats: { pts: 25.0 } } },
    { playerId: 'wr', projectedPoints: 14.0, stats: { stats: { pts: 14.0 } } },
    { playerId: 'bench1', projectedPoints: 2.0, stats: { stats: { pts: 2.0 } } },
    { playerId: 'starter1', projectedPoints: 15.0, stats: { stats: { pts: 15.0 } } },
  ] },
  sportsPlayer: { findMany: async () => [
    { id: 'tackle', externalId: null, sleeperId: 'tackle', name: 'Michael Tarquin', position: 'OT', team: 'CAR', imageUrl: null },
    { id: 'kicker', externalId: null, sleeperId: 'kicker', name: 'Kay Kicker', position: 'K', team: 'BAL', imageUrl: null },
    { id: 'wr', externalId: null, sleeperId: 'wr', name: 'Willie Receiver', position: 'WR', team: 'DAL', imageUrl: null },
    { id: 'bench1', externalId: null, sleeperId: 'bench1', name: 'Bench Guy', position: 'WR', team: 'NYJ', imageUrl: null },
    { id: 'starter1', externalId: null, sleeperId: 'starter1', name: 'Starter Guy', position: 'RB', team: 'BUF', imageUrl: null },
  ] },
} }))
vi.mock('@/lib/projections/leagueScoring', () => ({
  extractScoringSettings: () => ({ rec: 1 }),
  computeLeagueProjectedPoints: (c: { pts?: number } | null) => (c?.pts != null ? { points: c.pts } : null),
}))
vi.mock('@/lib/core-app/rosteredMarket', () => ({
  MIN_LEAGUES_FOR_MARKET: 5,
  getRosteredMarket: async () => ({ leaguesCounted: 0, byPlayerId: new Map() }),
}))
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: async () => ({ season: 2026, week: 4 }) }))
vi.mock('@/lib/core-app/myRoster', () => ({ myRosterCandidates: () => ['me'] }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: async () => ({ byPlayer: new Map() }) }))

import { getWaiversBoard } from '@/lib/core-app/waiversBoard'

const add = async () => (await getWaiversBoard('me')).rows[0]?.add.name

beforeEach(() => {
  h.settings = {}
})

describe('waiver board: only a player this league could start', () => {
  it('withholds a league with no roster slots on file — and so still never names an offensive tackle', async () => {
    /*
     * No roster_positions: there is no lineup to improve, so the league is withheld and counted,
     * the league screen's own `no_slots` answer. This used to name the kicker on the strength of
     * "some fantasy slot somewhere accepts a K" — a gain against a lineup nobody could describe.
     */
    const board = await getWaiversBoard('me')
    expect(board.rows).toEqual([])
    expect(board.withheld.noScoring).toBe(1)
  })

  it('skips a kicker in a league with no K slot', async () => {
    h.settings = { roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'] }
    expect(await add()).toBe('Willie Receiver')
  })

  it('names the kicker where the league starts one', async () => {
    h.settings = { roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN'] }
    expect(await add()).toBe('Kay Kicker')
  })
})
