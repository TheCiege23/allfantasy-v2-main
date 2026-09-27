import { describe, expect, it } from 'vitest'
import { resolveTiebreak } from '@/lib/guillotine/GuillotineTiebreakResolver'
import type { PeriodScoreRow } from '@/lib/guillotine/types'

const row = (rosterId: string, periodPoints: number, seasonPointsCumul = 100): PeriodScoreRow => ({ rosterId, periodPoints, seasonPointsCumul })
const resolve = (candidates: PeriodScoreRow[], teamsPerChop = 2) => resolveTiebreak({ candidates, teamsPerChop, weekOrPeriod: 2, draftSlotByRoster: new Map(), tiebreakerOrder: ['season_points', 'previous_period'] })

describe('multi-team guillotine chop selection', () => {
  it('chops both lowest scores when they are distinct', () => {
    expect(resolve([row('a', 10), row('b', 20), row('c', 30), row('d', 40)]).choppedRosterIds).toEqual(['a', 'b'])
  })
  it('keeps a guaranteed chop and resolves the tie at the second spot', () => {
    expect(resolve([row('a', 10), row('b', 20, 200), row('c', 20, 100), row('d', 40)]).choppedRosterIds).toEqual(['a', 'c'])
  })
  it('fills two spots across different season-point groups within a tied score', () => {
    expect(resolve([row('a', 10, 50), row('b', 10, 100), row('c', 10, 200), row('d', 40)]).choppedRosterIds).toEqual(['a', 'b'])
  })
  it('uses the next tiebreaker only for the remaining boundary tie', () => {
    const candidates = [row('a', 10, 50), { ...row('b', 10, 100), previousPeriodPoints: 30 }, { ...row('c', 10, 100), previousPeriodPoints: 10 }, row('d', 40)]
    expect(resolve(candidates).choppedRosterIds).toEqual(['a', 'c'])
  })
  it('fills remaining slots after a partial commissioner tiebreak', () => {
    expect(resolveTiebreak({ candidates: [row('a', 10), row('b', 10), row('c', 10)], teamsPerChop: 2, weekOrPeriod: 2, draftSlotByRoster: new Map(), tiebreakerOrder: ['commissioner', 'season_points'], commissionerChoppedRosterIds: ['b'] }).choppedRosterIds).toEqual(['b', 'a'])
  })
  it('rejects invalid and duplicate commissioner ids as a complete override', () => {
    expect(resolveTiebreak({ candidates: [row('a', 10), row('b', 20), row('c', 30)], teamsPerChop: 2, weekOrPeriod: 2, draftSlotByRoster: new Map(), tiebreakerOrder: [], commissionerChoppedRosterIds: ['c', 'c', 'unknown'] }).choppedRosterIds).toEqual(['a', 'b'])
  })
  it('preserves single-team chop behavior', () => {
    expect(resolve([row('a', 10, 200), row('b', 10, 100), row('c', 30)], 1).choppedRosterIds).toEqual(['b'])
  })
  it('does not report a tiebreak when the entire tied group is chopped', () => {
    expect(resolve([row('a', 10), row('b', 10), row('c', 30)])).toMatchObject({ choppedRosterIds: ['a', 'b'], stepUsed: null })
  })
})
