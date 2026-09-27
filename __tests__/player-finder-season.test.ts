import { describe, expect, it } from 'vitest'

import { componentStats, projectionHeadline, statLinePpr, summarizeSeason, type SeasonWeek } from '@/lib/core-app/playerSeason'

/*
 * "This season" on the Player Finder card. Fixture shaped on production 2026-09-27 (Sleeper id 9509):
 * wk1 proj 21.5 / scored 31.3 PPR, wk2 proj 22.0 / 11.1, wk3 proj 20.1 / 35.3.
 */
const WEEKS: SeasonWeek[] = [
  { week: 1, opponent: 'PIT', projected: 21.5, actual: 31.3, played: true },
  { week: 2, opponent: 'CAR', projected: 22.0, actual: 11.1, played: true },
  { week: 3, opponent: 'GB', projected: 20.1, actual: 35.3, played: true },
  { week: 4, opponent: null, projected: 19.3, actual: null, played: false },
]

describe('summarizeSeason', () => {
  it('totals, averages and compares only weeks he played', () => {
    const s = summarizeSeason(WEEKS)
    expect(s).toMatchObject({ games: 3, total: 77.7, average: 25.9, compared: 3, beat: 2, best: { week: 3, points: 35.3 }, worst: { week: 2, points: 11.1 } })
    // |31.3-21.5| + |11.1-22.0| + |35.3-20.1| = 9.8 + 10.9 + 15.2 = 35.9 → 12.0
    expect(s.meanMiss).toBe(12)
  })

  it('a week with no stat line is not a zero', () => {
    const s = summarizeSeason([{ week: 1, opponent: null, projected: 18, actual: null, played: false }])
    expect(s).toMatchObject({ games: 0, total: 0, average: 0, compared: 0, meanMiss: null, best: null })
    expect(projectionHeadline(s)).toBeNull()
  })

  it('says how often the projection held, in words', () => {
    expect(projectionHeadline(summarizeSeason(WEEKS))).toBe('Met or beat his projection in 2 of 3 weeks · off by 12.0 a week on average')
  })
})

describe('stat line helpers', () => {
  it("reads the feed's own PPR total", () => {
    expect(statLinePpr({ pts_ppr: 31.3, pts_std: 23.3 })).toBe(31.3)
    expect(statLinePpr({ pts_std: 23.3 })).toBeNull()
    expect(statLinePpr(null)).toBeNull()
  })

  it('strips the feed aggregates before a league re-score, so a total is never scored as a stat', () => {
    expect(componentStats({ gp: 1, gs: 1, pts_ppr: 31.3, adp_ppr: 12, rec: 5, rec_yd: 110, note: 'x' })).toEqual({ rec: 5, rec_yd: 110 })
    expect(componentStats({ pts_ppr: 1 })).toBeNull()
  })
})
