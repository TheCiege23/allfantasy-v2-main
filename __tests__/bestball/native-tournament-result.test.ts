import { describe, expect, it } from 'vitest'
import { readNativeTournamentResult } from '@/lib/bestball/nativeTournamentResult'
const entry = (id: string, round: number, rank: number | null, points: number, weeklyScores: unknown = []) => ({ id: `c:${id}`, currentRound: round, overallRank: rank, totalPoints: points, weeklyScores })
describe('Tournament result validation', () => {
  it('orders earlier exits by round before comparing their scores', () => {
    const result = readNativeTournamentResult({ id: 'c', status: 'complete', rounds: 3, entries: [entry('A', 1, null, 999), entry('B', 2, null, 50), entry('C', 3, 1, 20), entry('D', 3, 2, 10)] }, ['A', 'B', 'C', 'D'], 'points_for')!
    expect([...result.finishByRosterId]).toEqual([['C', 1], ['D', 2], ['B', 3], ['A', 4]])
  })
  it('uses the saved max-week rule for teams eliminated in the same round', () => {
    const result = readNativeTournamentResult({ id: 'c', status: 'complete', rounds: 2, entries: [entry('A', 1, null, 100, [{ points: 50 }]), entry('B', 1, null, 100, [{ points: 75 }]), entry('C', 2, 1, 20)] }, ['A', 'B', 'C'], 'max_week')!
    expect(result.finishByRosterId.get('B')).toBe(2)
    expect(result.finishByRosterId.get('A')).toBe(3)
  })
  it.each([null, 0, NaN])('refuses a missing or invalid finalist rank %s', rank => {
    expect(readNativeTournamentResult({ id: 'c', status: 'complete', rounds: 1, entries: [entry('A', 1, rank, 20)] }, ['A'], 'points_for')).toBeNull()
  })
  it('refuses duplicate roster entry IDs', () => {
    expect(readNativeTournamentResult({ id: 'c', status: 'complete', rounds: 1, entries: [entry('A', 1, 1, 20), entry('A', 1, 2, 10)] }, ['A', 'B'], 'points_for')).toBeNull()
  })
})
