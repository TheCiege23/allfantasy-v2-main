import { describe, expect, it } from 'vitest'
import { createWeeklyPointsAgainst } from '@/lib/redraft/weeklyPointsAgainst'

describe('Points Against as a per-week average', () => {
  it('a week with one game contributes that opponent\'s score, as it always did', () => {
    const tally = createWeeklyPointsAgainst()
    tally.add('a', 1, 90)
    tally.add('a', 2, 110)
    expect(tally.totals().get('a')).toBe(200)
  })

  it('a week with several games contributes the average of its opponents', () => {
    const tally = createWeeklyPointsAgainst()
    for (const score of [100, 90, 80, 120, 110]) tally.add('a', 1, score)
    tally.add('a', 2, 95)
    tally.add('b', 1, 140)
    expect(tally.totals().get('a')).toBe(100 + 95)
    expect(tally.totals().get('b')).toBe(140)
  })

  it('a team with no games has no entry', () => {
    expect(createWeeklyPointsAgainst().totals().has('a')).toBe(false)
  })
})
