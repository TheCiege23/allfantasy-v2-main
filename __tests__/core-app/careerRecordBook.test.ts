import { describe, expect, it } from 'vitest'
import {
  buildRivals,
  draftRecords,
  RIVAL_MIN_MEETINGS,
  seasonRecords,
  tradeRecords,
  weeklyRecords,
  type CareerGame,
} from '@/lib/core-app/careerRecordBook'
import { row } from './careerFixtures'

function game(over: Partial<CareerGame> = {}): CareerGame {
  return {
    leagueId: 'L1',
    leagueName: 'Dynasty Dragons',
    season: 2023,
    week: 1,
    myScore: 110,
    oppScore: 100,
    result: 'W',
    oppKey: 'u:rival',
    oppName: 'Rival Ron',
    ...over,
  }
}

const byKey = (records: Array<{ key: string }>, key: string) => records.find((r) => r.key === key)

describe('weeklyRecords', () => {
  it('never chains a streak across two leagues', () => {
    const games = [
      game({ leagueId: 'L1', week: 1 }),
      game({ leagueId: 'L1', week: 2 }),
      game({ leagueId: 'L2', leagueName: 'Other', week: 1 }),
      game({ leagueId: 'L2', leagueName: 'Other', week: 2 }),
      game({ leagueId: 'L2', leagueName: 'Other', week: 3 }),
    ]
    const { records } = weeklyRecords(games)
    expect(byKey(records, 'win-streak')?.value).toBe('3 gms')
    expect(byKey(records, 'win-streak')?.context).toBe('Other · 2023')
  })

  it('a tie ends a streak without starting one', () => {
    const { records } = weeklyRecords([
      game({ week: 1 }),
      game({ week: 2, result: 'T', myScore: 100, oppScore: 100 }),
      game({ week: 3 }),
    ])
    expect(byKey(records, 'win-streak')?.value).toBe('1 gms')
    expect(byKey(records, 'loss-streak')).toBeUndefined()
  })

  it('takes highs, lows and margins from the games, never a zero', () => {
    const { records } = weeklyRecords([
      game({ week: 1, myScore: 150, oppScore: 90 }),
      game({ week: 2, myScore: 80, oppScore: 120, result: 'L' }),
      game({ week: 3, myScore: 101, oppScore: 100.5 }),
    ])
    expect(byKey(records, 'high-week')?.value).toBe('150.0')
    expect(byKey(records, 'low-week')?.value).toBe('80.0')
    expect(byKey(records, 'blowout')?.value).toBe('+60.0')
    expect(byKey(records, 'closest')?.value).toBe('+0.5')
    expect(byKey(records, 'worst-loss')?.value).toBe('−40.0')
    expect(weeklyRecords([]).records).toEqual([])
  })
})

describe('buildRivals', () => {
  it('is one rival across leagues when the provider user is the same', () => {
    const rivals = buildRivals([
      game({ leagueId: 'L1', week: 1 }),
      game({ leagueId: 'L2', leagueName: 'Other', week: 1, result: 'L', myScore: 90, oppScore: 95 }),
      game({ leagueId: 'L2', leagueName: 'Other', week: 5, oppKey: 'u:someone', oppName: 'Someone' }),
    ])
    expect(rivals[0]).toMatchObject({ key: 'u:rival', meetings: 2, wins: 1, losses: 1, leagues: ['Dynasty Dragons', 'Other'] })
    expect(rivals).toHaveLength(2)
  })

  it('skips a game whose opponent could not be resolved', () => {
    expect(buildRivals([game({ oppKey: null })])).toEqual([])
  })

  it('names best and toughest only after enough meetings', () => {
    const few = weeklyRecords([game({ week: 1 }), game({ week: 2 })])
    expect(byKey(few.records, 'rival-most')).toBeDefined()
    expect(byKey(few.records, 'rival-best')).toBeUndefined()

    const many = [
      ...Array.from({ length: RIVAL_MIN_MEETINGS }, (_, i) => game({ week: i + 1 })),
      ...Array.from({ length: RIVAL_MIN_MEETINGS }, (_, i) =>
        game({ week: i + 10, oppKey: 'u:nemesis', oppName: 'Nemesis', result: 'L', myScore: 80, oppScore: 120 }),
      ),
    ]
    const { records } = weeklyRecords(many)
    expect(byKey(records, 'rival-best')?.context).toMatch(/^Rival Ron/)
    expect(byKey(records, 'rival-worst')?.context).toMatch(/^Nemesis/)
    expect(byKey(records, 'rival-worst')?.value).toBe('0-3')
  })
})

describe('seasonRecords', () => {
  it('finds consecutive titles and berths inside one league only', () => {
    const records = seasonRecords([
      row({ season: 2020, isChampion: true, madePlayoffs: true }),
      row({ season: 2021, isChampion: true, madePlayoffs: true }),
      row({ season: 2022, madePlayoffs: true }),
      row({ season: 2023, leagueName: 'Elsewhere', isChampion: true, madePlayoffs: true }),
    ])
    expect(byKey(records, 'title-streak')?.value).toBe('2 in a row')
    expect(byKey(records, 'playoff-streak')?.value).toBe('3 seasons')
    expect(byKey(records, 'league-titles')?.value).toBe('2')
  })

  it('does not bridge a skipped season', () => {
    const records = seasonRecords([
      row({ season: 2019, isChampion: true }),
      row({ season: 2021, isChampion: true }),
    ])
    expect(byKey(records, 'title-streak')).toBeUndefined()
  })

  it('leaves out points records when no season recorded points', () => {
    const records = seasonRecords([row({ pointsFor: null })])
    expect(byKey(records, 'most-points-season')).toBeUndefined()
    expect(byKey(records, 'best-record')).toBeDefined()
  })

  it('ignores seasons still being played', () => {
    expect(seasonRecords([row({ counted: false })])).toEqual([])
  })
})

describe('tradeRecords and draftRecords', () => {
  it('counts trades per season across leagues and only calls a trade bad when it lost points', () => {
    const records = tradeRecords(
      [
        { season: 2022, leagueKey: 'a', count: 4, maxAssets: 2 },
        { season: 2022, leagueKey: 'b', count: 3, maxAssets: 5 },
        { season: 2023, leagueKey: 'a', count: 6, maxAssets: 1 },
      ],
      [
        { id: 't1', date: '2022-10-01T00:00:00Z', season: 2022, leagueName: 'A', net: 55, initialGrade: 'B', currentGrade: 'A', received: ['Player One'], sent: ['Player Two'], partner: 'X' },
        { id: 't2', date: '2023-10-01T00:00:00Z', season: 2023, leagueName: 'A', net: 5, initialGrade: 'C', currentGrade: 'C', received: [], sent: [], partner: 'Y' },
      ],
    )
    expect(byKey(records, 'trades-season')).toMatchObject({ value: '7', context: '2022 · across your leagues' })
    expect(byKey(records, 'trade-size')?.value).toBe('5 assets')
    expect(byKey(records, 'trade-best')?.value).toBe('+55 pts')
    expect(byKey(records, 'trade-worst')).toBeUndefined()
  })

  it('returns nothing for an account with no trades or drafts', () => {
    expect(tradeRecords([], [])).toEqual([])
    expect(draftRecords([], [], 0)).toEqual([])
  })

  it('names the best draft and the best value pick', () => {
    const records = draftRecords(
      [
        { season: 2021, leagueName: 'A', grade: 'A', score: 30, picks: 15, scoringNote: null },
        { season: 2022, leagueName: 'B', grade: 'D', score: -12, picks: 15, scoringNote: null },
      ],
      [{ season: 2021, leagueName: 'A', playerName: 'Late Gem', round: 9, pickNo: 101, valueOver: 44.4 }],
      30,
    )
    expect(byKey(records, 'draft-best')?.value).toBe('A')
    expect(byKey(records, 'draft-worst')?.value).toBe('D')
    expect(byKey(records, 'draft-steal')?.value).toBe('+44')
    expect(byKey(records, 'draft-picks')?.value).toBe('30')
  })
})
