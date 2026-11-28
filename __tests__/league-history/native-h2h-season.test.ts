// @vitest-environment node
/**
 * A native season as the shared head-to-head input (lib/league-history/nativeH2HSeason.ts), so the native weekly recap
 * prints the SAME weekly awards, from the SAME calculator and wording, as the Sleeper recap.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { nativeH2HSeasonData } from '@/lib/league-history/nativeH2HSeason'
import { aggregateH2HSeasons } from '@/lib/league-history/sleeperH2HService'
import { weeklyAwardLines } from '@/lib/league-chat/weeklyRecapMoment'

const teams = [
  { id: 'a', teamName: 'Aces', ownerName: 'ann' },
  { id: 'b', teamName: null, ownerName: 'Bob' },
  { id: 'c', teamName: 'Colts', ownerName: 'cy' },
  { id: 'd', teamName: 'Dons', ownerName: 'di' },
]
const game = (week: number, home: string, away: string | null, hs: number | null, as: number | null, status = 'final', isMedianMatchup = false) => ({
  week, homeRosterId: home, awayRosterId: away, homeScore: hs, awayScore: as, status, isMedianMatchup,
})

describe('nativeH2HSeasonData', () => {
  const rows = [
    game(1, 'a', 'b', 120, 90),
    game(1, 'c', 'd', 100, 99),
    game(2, 'a', 'c', 140.5, 80),
    game(2, 'b', 'd', 101, 100),
    game(2, 'a', null, 0, null), // a bye row
    game(2, 'a', 'median', 150, 0, 'final', true), // the league-median game
    game(3, 'a', 'b', 0, 0, 'scheduled'), // not played yet
  ]
  const data = nativeH2HSeasonData({ season: 2026, games: rows, teams, throughWeek: 2 })

  it('keeps finished head-to-head games only, through the recapped week', () => {
    expect(data.games.map((g) => `${g.week}:${g.aOwnerId}-${g.bOwnerId}`)).toEqual(['1:a-b', '1:c-d', '2:a-c', '2:b-d'])
    expect(data.season).toBe('2026')
  })

  it('names a team by team name, else owner name', () => {
    expect(data.managers.a.name).toBe('Aces')
    expect(data.managers.b.name).toBe('Bob')
  })

  it("the awards are the recapped week's, from the shared calculator", () => {
    const awards = aggregateH2HSeasons([data]).latestWeekAwards!
    expect(awards.week).toBe(2)
    expect(awards.topScore).toMatchObject({ ownerId: 'a', points: 140.5 })
    expect(awards.lowScore).toMatchObject({ ownerId: 'c', points: 80 })
    expect(awards.narrowEscape).toMatchObject({ winnerOwnerId: 'b', loserOwnerId: 'd', margin: 1 })
    expect(awards.biggestBlowout).toMatchObject({ winnerOwnerId: 'a', loserOwnerId: 'c' })
  })

  it('[control] a later week is left out: recapping week 1 never names week 2', () => {
    const week1 = aggregateH2HSeasons([nativeH2HSeasonData({ season: 2026, games: rows, teams, throughWeek: 1 })]).latestWeekAwards!
    expect(week1.week).toBe(1)
    expect(week1.topScore).toMatchObject({ ownerId: 'a', points: 120 })
  })

  it('the native and Sleeper recaps word the awards the same, from one function', () => {
    const awards = aggregateH2HSeasons([data]).latestWeekAwards!
    const lines = weeklyAwardLines(awards, (id) => (id ? data.managers[id]?.name : undefined) ?? 'Open team')
    expect(lines).toEqual([
      '',
      '🏆 Weekly awards',
      '  🚀 Boom of the week: Aces, 140.5',
      '  🥀 Bust of the week: Colts, 80.0',
      '  😅 Narrow escape: Bob over Dons by 1.0',
      '  🔨 Hammer of the week: Aces over Colts by 60.5',
    ])
  })
})
