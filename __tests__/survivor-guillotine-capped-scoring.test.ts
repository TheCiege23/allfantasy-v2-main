import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { calculateCappedGameScores, scoreNbaGame } from '@/lib/survivor-guillotine/capped-scoring'

const day = (n: number) => new Date(`2026-11-${String(n).padStart(2, '0')}T00:00:00Z`)

describe('Survivor Guilly NBA capped games', () => {
  it('counts the first N player-games, including zeroes, rather than the highest N', () => {
    const scores = calculateCappedGameScores(['a', 'b'], [
      { rosterId: 'a', playerId: 'p1', gameId: 'g3', gameDate: day(3), points: 90 },
      { rosterId: 'a', playerId: 'p1', gameId: 'g1', gameDate: day(1), points: 0 },
      { rosterId: 'a', playerId: 'p2', gameId: 'g2', gameDate: day(2), points: 7 },
      { rosterId: 'b', playerId: 'p3', gameId: 'g1', gameDate: day(1), points: 11 },
    ], 2)
    expect([...scores]).toEqual([['a', 7], ['b', 11]])
  })

  it('rejects duplicate player-games and invalid cap inputs', () => {
    const game = { rosterId: 'a', playerId: 'p1', gameId: 'g1', gameDate: day(1), points: 2 }
    expect(() => calculateCappedGameScores(['a'], [game, game], 1)).toThrow('Duplicate')
    expect(() => calculateCappedGameScores(['a'], [game], 0)).toThrow('positive')
  })

  it('uses the same cap across both halves of an NBA combined scoring period', () => {
    const games = [
      { rosterId: 'a', playerId: 'p1', gameId: 'before-break', gameDate: new Date('2027-02-12T00:00:00Z'), points: 4 },
      { rosterId: 'a', playerId: 'p1', gameId: 'after-break', gameDate: new Date('2027-02-21T00:00:00Z'), points: 8 },
      { rosterId: 'a', playerId: 'p1', gameId: 'later', gameDate: new Date('2027-02-23T00:00:00Z'), points: 100 },
    ]
    expect(calculateCappedGameScores(['a'], games, 2).get('a')).toBe(12)
  })

  it('scores an unscored live box row from league rules, including numeric stat aliases', () => {
    expect(scoreNbaGame({ stats: { pts: 20, reb: 10, ast: 5, text: 'ignored' }, scored: false }, [
      { statKey: 'points', pointsValue: 1, multiplier: 1, enabled: true },
      { statKey: 'rebounds', pointsValue: 1.2, multiplier: 1, enabled: true },
      { statKey: 'assists', pointsValue: 1.5, multiplier: 1, enabled: true },
    ])).toBe(39.5)
  })
})
