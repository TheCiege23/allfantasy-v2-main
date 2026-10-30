/** Every team's future picks on one screen (phase 6, 2026-10-27). */
import { describe, expect, it } from 'vitest'
import { buildLeaguePickBoard, type BoardPickInput } from '@/lib/dynasty-core/leaguePickBoard'

const teams = [
  { rosterId: 'a', name: 'Aces' },
  { rosterId: 'b', name: 'Bears' },
  { rosterId: 'c', name: 'Cubs' },
]
const own = (season: number, round: number, id: string): BoardPickInput => ({ season, round, ownerRosterId: id, originalRosterId: id })

describe('buildLeaguePickBoard', () => {
  // 2027 and 2028, two rounds. Bears traded their 2027 1st to Aces; Cubs traded their 2028 2nd to Bears.
  const picks: BoardPickInput[] = [
    own(2027, 1, 'a'), own(2027, 2, 'a'), own(2028, 1, 'a'), own(2028, 2, 'a'),
    { season: 2027, round: 1, ownerRosterId: 'a', originalRosterId: 'b' }, own(2027, 2, 'b'), own(2028, 1, 'b'), own(2028, 2, 'b'),
    own(2027, 1, 'c'), own(2027, 2, 'c'), own(2028, 1, 'c'), { season: 2028, round: 2, ownerRosterId: 'b', originalRosterId: 'c' },
  ]
  const board = buildLeaguePickBoard({ teams, picks, seasons: [2028, 2027], rounds: 2, coverage: 'complete', viewerRosterId: 'c' })
  const team = (id: string) => board.teams.find((t) => t.rosterId === id)!

  it('lists each team’s picks by draft year, naming where an acquired pick came from', () => {
    expect(board.seasons).toEqual([2027, 2028])
    expect(team('a').bySeason[2027]).toEqual([
      { season: 2027, round: 1, label: '1st', fromTeam: null },
      { season: 2027, round: 1, label: '1st', fromTeam: 'Bears' },
      { season: 2027, round: 2, label: '2nd', fromTeam: null },
    ])
    expect(team('a')).toMatchObject({ total: 5, firsts: 3 })
  })

  it('shows a team’s own picks another team now holds', () => {
    expect(team('b').tradedAwayBySeason[2027]).toEqual([{ round: 1, label: '1st', toTeam: 'Aces' }])
    expect(team('c').tradedAwayBySeason[2028]).toEqual([{ round: 2, label: '2nd', toTeam: 'Bears' }])
    expect(team('a').tradedAwayBySeason[2027]).toEqual([])
  })

  it('puts the viewer first, then the teams holding the most firsts', () => {
    expect(board.teams.map((t) => [t.rosterId, t.isViewer])).toEqual([['c', true], ['a', false], ['b', false]])
  })

  it('ignores a pick outside the window or held by no team in the league', () => {
    const b = buildLeaguePickBoard({ teams, picks: [own(2031, 1, 'a'), own(2027, 1, 'ghost')], seasons: [2027], rounds: 1, coverage: 'traded_only', viewerRosterId: null })
    expect(b.teams.every((t) => t.total === 0)).toBe(true)
    expect(b.coverage).toBe('traded_only')
  })
})
