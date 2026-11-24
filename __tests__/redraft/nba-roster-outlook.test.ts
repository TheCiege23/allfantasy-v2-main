/**
 * The NBA week outlook on the Matchup tab (lib/redraft/nbaRosterOutlook*.ts): next game, tip-off, the
 * week's game count, crests and the next opponent's rank against the position. An NBA league showed
 * none of it (owner report, 2026-11-24).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const st = vi.hoisted(() => ({ games: [] as unknown[], lines: [] as unknown[] }))
vi.mock('@/lib/redraft/weekGames', () => ({ readWeekGames: vi.fn(async () => st.games) }))
vi.mock('@/lib/season-week/dailySportSeasonStarts', () => ({
  resolveDailySportWeekWindow: () => ({ start: new Date('2026-11-23T00:00:00Z'), end: new Date('2026-11-30T00:00:00Z') }),
}))
vi.mock('@/lib/sport-teams/storedTeamLogos', () => ({
  getStoredTeamLogoResolver: async () => (t: string | null | undefined) => (t ? `https://logo/${String(t).replace(/\s+/g, '-')}.png` : null),
}))

import { nbaNextGame, nbaPrimaryPosition, nbaRankingPoints } from '@/lib/redraft/nbaRosterOutlookModel'
import { clearNbaRosterOutlookCache, loadNbaRosterOutlook } from '@/lib/redraft/nbaRosterOutlook'

const g = (home: string, away: string, iso: string) => ({ homeTeam: home, awayTeam: away, startTime: new Date(iso) })
const WEEK = [
  g('Denver Nuggets', 'Phoenix Suns', '2026-11-24T02:00:00Z'),
  g('Los Angeles Lakers', 'Denver Nuggets', '2026-11-26T03:30:00Z'),
  g('Denver Nuggets', 'Utah Jazz', '2026-11-29T01:00:00Z'),
  g('Boston Celtics', 'Miami Heat', '2026-11-25T00:30:00Z'),
]

describe('nbaNextGame', () => {
  it('is the club’s next game not yet started, with the week’s count', () => {
    const n = nbaNextGame(WEEK, 'Denver Nuggets', new Date('2026-11-25T12:00:00Z'))!
    expect(n).toMatchObject({ opponent: 'LAL', home: false, gamesThisWeek: 3, opponentName: 'Los Angeles Lakers' })
    expect(n.at.toISOString()).toBe('2026-11-26T03:30:00.000Z')
  })
  it('is the last game once every game has started', () => {
    const n = nbaNextGame(WEEK, 'DEN', new Date('2026-12-01T00:00:00Z'))!
    expect(n).toMatchObject({ opponent: 'UTA', home: true })
  })
  it('[control] a club with no game in the week has none', () => {
    expect(nbaNextGame(WEEK, 'Chicago Bulls', new Date('2026-11-25T00:00:00Z'))).toBeNull()
  })
})

describe('nbaRankingPoints', () => {
  it('prices a box score line from its counts', () => {
    expect(nbaRankingPoints({ points: 20, total_rebounds: 10, assists: 5, steals: 1, blocks: 1, turnovers: 2 })).toBeCloseTo(20 + 12 + 7.5 + 3 + 3 - 2)
  })
  it('[control] a line without points is not priced', () => {
    expect(nbaRankingPoints({ assists: 3 })).toBeNull()
  })
  it('takes the first of a combined position', () => {
    expect(nbaPrimaryPosition('sg-sf')).toBe('SG')
  })
})

describe('loadNbaRosterOutlook', () => {
  beforeEach(() => {
    clearNbaRosterOutlookCache()
    st.games = WEEK
    // Three games against each defense, so every defense is ranked (MIN_GAMES = 3).
    const line = (defense: string, day: string, points: number) => ({ defense, position: 'PG', gameDate: day, stats: { points } })
    st.lines = [
      ...['2026-11-01', '2026-11-03', '2026-11-05'].map((d) => line('LAL', d, 30)),
      ...['2026-11-01', '2026-11-03', '2026-11-05'].map((d) => line('PHX', d, 10)),
    ]
  })
  const db = { $queryRaw: vi.fn(async () => st.lines) } as never

  it('gives an NBA starter his next game, the count, crests and the opponent’s rank vs his position', async () => {
    const out = await loadNbaRosterOutlook(db, {
      league: { sport: 'NBA', season: 2026 },
      players: [{ id: '759', team: 'Denver Nuggets', position: 'PG' }],
      week: 6,
      now: new Date('2026-11-25T12:00:00Z'),
    })
    expect(out.get('759')).toMatchObject({
      opponent: 'LAL',
      homeAway: 'away',
      kickoffTimeIso: '2026-11-26T03:30:00.000Z',
      gamesThisWeek: 3,
      teamLogoUrl: 'https://logo/Denver-Nuggets.png',
      opponentLogoUrl: 'https://logo/Los-Angeles-Lakers.png',
      // The Lakers allow the most to point guards of the two: 2nd of 2.
      opponentRank: { rank: 2, of: 2, position: 'PG', allowedPerGame: 30, games: 3 },
    })
  })

  it('[control] another sport gets nothing', async () => {
    const out = await loadNbaRosterOutlook(db, { league: { sport: 'NFL', season: 2026 }, players: [{ id: '1', team: 'DEN', position: 'QB' }], week: 6 })
    expect(out.size).toBe(0)
  })
})
