import { describe, expect, it } from 'vitest'
import { rankBestBallEntries, selectBestBallAdvancers } from '@/lib/bestball/advancementRanking'
const entries = [
  { id: 'a', totalPoints: 200, weeklyScores: [{ week: 1, points: 100 }, { week: 2, points: 100 }] },
  { id: 'b', totalPoints: 200, weeklyScores: [{ week: 1, points: 140 }, { week: 2, points: 60 }] },
  { id: 'c', totalPoints: 190, weeklyScores: [{ week: 1, points: 180 }] },
  { id: 'd', totalPoints: 210, weeklyScores: [{ week: 1, points: 110 }, { week: 2, points: 100 }] },
]
describe('best-ball advancement tie choices', () => {
  it('uses highest week only after cumulative points tie', () => {
    expect(rankBestBallEntries(entries, 'max_week').map(row => row.id)).toEqual(['d', 'b', 'a', 'c'])
    expect(selectBestBallAdvancers(rankBestBallEntries(entries, 'max_week'), 2, 'max_week').map(row => row.id)).toEqual(['d', 'b'])
  })
  it('advances all teams tied at the cutoff only for advance_all', () => {
    expect(selectBestBallAdvancers(rankBestBallEntries(entries, 'advance_all'), 2, 'advance_all').map(row => row.id)).toEqual(['d', 'a', 'b'])
    expect(selectBestBallAdvancers(rankBestBallEntries(entries, 'points_for'), 2, 'points_for').map(row => row.id)).toEqual(['d', 'a'])
  })
  it('rejects zero advancers instead of treating every team as a winner', () => {
    expect(() => selectBestBallAdvancers(entries, 0, 'advance_all')).toThrow('Invalid advancer count')
  })
})
