// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

/**
 * The waiver board names players from Sleeper ids — and Rolling Insights writes its OWN numbers into
 * `SportsPlayer.externalId`. Sleeper 9228 is Bryce Young; RI 9228 is Michael Tarquin, an offensive
 * tackle. The board read `externalId IN (ids)` and keyed its map by that column too, so on
 * 2026-09-29 Chimmy's Tuesday digest told the App Review account to "add Michael Tarquin (OT,
 * Carolina Panthers)" with Bryce Young's projection. 422 of the top 900 week-4 projections had such
 * an impostor in production. The mock database below honours the query's `where`, as Postgres does.
 */
type Player = { id: string; sleeperId: string | null; externalId: string | null; source: string; name: string; position: string; team: string; imageUrl: null }
const PLAYERS: Player[] = [
  { id: 'u1', sleeperId: '9228', externalId: 'sleeper:9228', source: 'sleeper', name: 'Bryce Young', position: 'QB', team: 'CAR', imageUrl: null },
  { id: 'u2', sleeperId: null, externalId: '9228', source: 'rolling_insights', name: 'Michael Tarquin', position: 'OT', team: 'Carolina Panthers', imageUrl: null },
  { id: 'u3', sleeperId: 'bench1', externalId: 'sleeper:bench1', source: 'sleeper', name: 'Bench Guy', position: 'WR', team: 'NYJ', imageUrl: null },
  { id: 'u4', sleeperId: 'starter1', externalId: 'sleeper:starter1', source: 'sleeper', name: 'Starter Guy', position: 'RB', team: 'BUF', imageUrl: null },
]

type Where = { sport?: string; OR?: Array<{ sleeperId?: { in: string[] }; externalId?: { in: string[] }; id?: { in: string[] } }> }
function matches(p: Player, where: Where): boolean {
  if (where.sport && where.sport !== 'NFL') return false
  return (where.OR ?? []).some((c) =>
    (c.sleeperId && p.sleeperId != null && c.sleeperId.in.includes(p.sleeperId)) ||
    (c.externalId && p.externalId != null && c.externalId.in.includes(p.externalId)) ||
    (c.id && c.id.in.includes(p.id)),
  )
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  leagueTeam: { findMany: async () => [{
    leagueId: 'lg', externalId: '1', platformUserId: 'me',
    /* A QB slot nobody on the roster fills, so the board's lineup-gain rule has a seat for 9228. */
    league: { id: 'lg', name: 'Test League', platform: 'sleeper', sport: 'NFL', settings: { roster_positions: ['QB', 'RB', 'WR', 'BN'] }, platformLeagueId: 'SL', leagueType: 'redraft', scoring: 'ppr', logoUrl: null, avatarUrl: null },
  }] },
  roster: { findMany: async () => [{ leagueId: 'lg', platformUserId: 'me', faabRemaining: 100, playerData: { players: ['bench1', 'starter1'], starters: ['starter1'] } }] },
  leagueWaiverSettings: { findMany: async () => [] },
  sportsGame: { findMany: async () => [] },
  fantasyProjection: { findMany: async () => [
    { playerId: '9228', projectedPoints: 18.5, stats: { stats: { pts: 18.5 } } },
    { playerId: 'bench1', projectedPoints: 2.0, stats: { stats: { pts: 2.0 } } },
    { playerId: 'starter1', projectedPoints: 15.0, stats: { stats: { pts: 15.0 } } },
  ] },
  sportsPlayer: {
    findMany: async ({ where }: { where: Where }) => PLAYERS.filter((p) => matches(p, where)),
  },
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

describe('waiver board: Sleeper ids never resolve through a provider externalId', () => {
  it('names Sleeper 9228 as Bryce Young (QB), not the Rolling Insights row that shares the number', async () => {
    const add = (await getWaiversBoard('me')).rows[0]?.add
    expect(add).toMatchObject({ name: 'Bryce Young', position: 'QB' })
  })
})
