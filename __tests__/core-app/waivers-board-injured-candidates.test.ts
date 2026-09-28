// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The waiver board ranks by the projection feed, which does not know who is hurt. Measured on
 * production 2026-09-28: Jaxson Dart, on IR, was the #1 add in three leagues at 27.4 projected.
 */
const h = vi.hoisted(() => ({
  injuries: new Map<string, { status: string; stale: boolean }>(),
  injuryReadFails: false,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  leagueTeam: { findMany: async () => [{
    leagueId: 'lg', externalId: '1', platformUserId: 'me',
    league: { id: 'lg', name: 'Test League', platform: 'sleeper', sport: 'NFL', settings: {}, platformLeagueId: 'SL', leagueType: 'redraft', scoring: 'ppr', logoUrl: null, avatarUrl: null },
  }] },
  roster: { findMany: async () => [{ leagueId: 'lg', platformUserId: 'me', faabRemaining: 100, playerData: { players: ['bench1', 'starter1'], starters: ['starter1'] } }] },
  leagueWaiverSettings: { findMany: async () => [] },
  /* Week 3: two fixtures, one stored twice (two sources) — one kicked off, one still to play. */
  sportsGame: { findMany: async () => [
    { homeTeam: 'Chicago Bears', awayTeam: 'Philadelphia Eagles', startTime: new Date('2000-01-01T00:00:00Z') },
    { homeTeam: 'CHI', awayTeam: 'PHI', startTime: new Date('2000-01-01T00:00:00Z') },
    { homeTeam: 'Buffalo Bills', awayTeam: 'Miami Dolphins', startTime: new Date('2999-01-01T00:00:00Z') },
  ] },
  fantasyProjection: { findMany: async () => [
    { playerId: 'dart', projectedPoints: 27.4, stats: { stats: { pts: 27.4 } } },
    { playerId: 'mahomes', projectedPoints: 24.0, stats: { stats: { pts: 24.0 } } },
    { playerId: 'q', projectedPoints: 20.0, stats: { stats: { pts: 20.0 } } },
    { playerId: 'bench1', projectedPoints: 2.0, stats: { stats: { pts: 2.0 } } },
    { playerId: 'starter1', projectedPoints: 15.0, stats: { stats: { pts: 15.0 } } },
  ] },
  sportsPlayer: { findMany: async () => [
    { id: 'dart', externalId: null, sleeperId: 'dart', name: 'Jaxson Dart', position: 'QB', team: 'NYG', imageUrl: null },
    { id: 'mahomes', externalId: null, sleeperId: 'mahomes', name: 'Patrick Mahomes', position: 'QB', team: 'KC', imageUrl: null },
    { id: 'q', externalId: null, sleeperId: 'q', name: 'Quincy Questionable', position: 'WR', team: 'DAL', imageUrl: null },
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
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: async () => ({ season: 2026, week: 3 }) }))
vi.mock('@/lib/core-app/myRoster', () => ({ myRosterCandidates: () => ['me'] }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({
  resolveInjuryFacts: async () => {
    if (h.injuryReadFails) throw new Error('feed down')
    return { byPlayer: new Map([...h.injuries].map(([k, v]) => [k, { ...v }])) }
  },
}))

import { getWaiversBoard } from '@/lib/core-app/waiversBoard'

const add = async () => (await getWaiversBoard('me')).rows[0]?.add.name

beforeEach(() => {
  h.injuries = new Map()
  h.injuryReadFails = false
})

describe('waiver board: a pickup who cannot play is not a gain', () => {
  it('never names a player on IR as the add', async () => {
    h.injuries.set('jaxson dart', { status: 'IR', stale: true })
    expect(await add()).toBe('Patrick Mahomes')
  })

  it('never names a player ruled Out this week as the add', async () => {
    h.injuries.set('jaxson dart', { status: 'Out', stale: false })
    h.injuries.set('patrick mahomes', { status: 'Suspension', stale: false })
    expect(await add()).toBe('Quincy Questionable')
  })

  it('keeps Questionable eligible — uncertainty is not absence', async () => {
    h.injuries.set('jaxson dart', { status: 'IR', stale: false })
    h.injuries.set('patrick mahomes', { status: 'IR', stale: false })
    h.injuries.set('quincy questionable', { status: 'Questionable', stale: false })
    expect(await add()).toBe('Quincy Questionable')
  })

  it("does not exclude on last week's stale game-day Out", async () => {
    h.injuries.set('jaxson dart', { status: 'Out', stale: true })
    expect(await add()).toBe('Jaxson Dart')
  })

  it('excludes nobody when the injury feed cannot be read', async () => {
    h.injuryReadFails = true
    expect(await add()).toBe('Jaxson Dart')
  })
})

describe('waiver board: which week it is pricing', () => {
  it('hands over one kickoff per fixture (club pair across sources) and no clock-derived count', async () => {
    const board = await getWaiversBoard('me')
    expect(board.at).toEqual({ season: 2026, week: 3 })
    expect(board.weekKickoffs).toEqual(['2000-01-01T00:00:00.000Z', '2999-01-01T00:00:00.000Z'])
  })
})
