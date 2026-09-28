import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ matchups: vi.fn(), starters: vi.fn(), players: vi.fn(), games: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { findMany: h.matchups },
    leaguePlayerWeeklyScore: { findMany: h.starters },
    sportsPlayer: { findMany: h.players },
    sportsGame: { findMany: h.games },
  },
}))

import { loadEliminationSettle } from '@/lib/core-app/eliminationSettleLoader'

/*
 * The DB-shaped version of the live case: the user (roster 4) and the team in last (roster 7) have
 * starters only in finished games; roster 9 has one starter in tonight's game, still to play.
 * Real club codes, synthetic player ids.
 */
const now = Date.now()
const past = new Date(now - 20 * 3_600_000)
const tonight = new Date(now + 2 * 3_600_000)
const fresh = new Date(now - 60_000)

const GAMES = [
  { homeTeam: 'CIN', awayTeam: 'DET', status: 'final', startTime: past, fetchedAt: past, seasonType: 'regular' },
  { homeTeam: 'ARI', awayTeam: 'NYJ', status: 'final', startTime: past, fetchedAt: past, seasonType: 'regular' },
  { homeTeam: 'DEN', awayTeam: 'KC', status: 'final', startTime: past, fetchedAt: past, seasonType: 'regular' },
  { homeTeam: 'PHI', awayTeam: 'CHI', status: 'scheduled', startTime: tonight, fetchedAt: fresh, seasonType: 'regular' },
]
const PLAYERS = [
  ['p-cin', 'CIN'], ['p-ari', 'ARI'], ['p-nyj', 'NYJ'], ['p-det', 'DET'], ['p-den', 'DEN'], ['p-kc', 'KC'], ['p-phi', 'PHI'],
].map(([sleeperId, team]) => ({ sleeperId, name: sleeperId, position: 'WR', team, sport: 'NFL', imageUrl: null }))

const starters = (rosterId: number, ids: string[]) => ids.map((playerId) => ({ playerId, rosterId }))

beforeEach(() => {
  vi.clearAllMocks()
  h.matchups.mockResolvedValue([
    { rosterId: '4', pointsFor: 87.74, pointsAgainst: 0 },
    { rosterId: '7', pointsFor: 46.54, pointsAgainst: 0 },
    { rosterId: '9', pointsFor: 60.44, pointsAgainst: 0 },
    { rosterId: '5', pointsFor: 0, pointsAgainst: 0 }, // chopped in week 1: no score, not in the field
  ])
  h.starters.mockResolvedValue([
    ...starters(4, ['p-cin', 'p-ari', 'p-nyj', 'p-det', 'p-den']),
    ...starters(7, ['p-kc', 'p-cin', 'p-den']),
    ...starters(9, ['p-phi', 'p-ari']),
  ])
  h.players.mockResolvedValue(PLAYERS)
  h.games.mockResolvedValue(GAMES)
})

describe('loadEliminationSettle', () => {
  it('reads the live case as decided: yours and the last team\'s starters are all in finished games', async () => {
    const s = await loadEliminationSettle({ platformLeagueId: '999', season: 2026, week: 3, yourRosterId: '4' })
    expect(s).toMatchObject({ verdict: 'safe', finishedBelow: 1, chops: 1 })
    // The week is read, not a range: same league, season and week everywhere.
    expect(h.matchups).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: '999', seasonYear: 2026, week: 3 } }))
    expect(h.starters).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: '999', seasonYear: 2026, week: 3, isStarter: true } }))
  })

  it('a finished-looking last team with NO starter rows on file is unknown, so nothing is decided', async () => {
    h.starters.mockResolvedValue([...starters(4, ['p-cin']), ...starters(9, ['p-phi'])])
    const s = await loadEliminationSettle({ platformLeagueId: '999', season: 2026, week: 3, yourRosterId: '4' })
    expect(s?.verdict).toBe('open')
  })

  it('a starter still to play tonight keeps YOUR week open', async () => {
    h.starters.mockResolvedValue([...starters(4, ['p-cin', 'p-phi']), ...starters(7, ['p-kc'])])
    const s = await loadEliminationSettle({ platformLeagueId: '999', season: 2026, week: 3, yourRosterId: '4' })
    expect(s).toMatchObject({ verdict: 'open', yourUpcoming: 1 })
  })

  it('uses the published schedule\'s chops: Survivor All-Stars week 11 takes two teams', async () => {
    const s = await loadEliminationSettle({ platformLeagueId: '1387654855463534592', season: 2026, week: 11, yourRosterId: '4' })
    // Only one finished team is below the user, and the Gauntlet chops two.
    expect(s).toMatchObject({ verdict: 'open', chops: 2, finishedBelow: 1 })
  })

  it('returns null rather than a verdict when a read fails', async () => {
    h.games.mockRejectedValue(new Error('db down'))
    expect(await loadEliminationSettle({ platformLeagueId: '999', season: 2026, week: 3, yourRosterId: '4' })).toBeNull()
  })
})
