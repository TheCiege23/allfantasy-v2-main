import { describe, expect, it } from 'vitest'
import { resolveTiebreak } from '@/lib/guillotine/GuillotineTiebreakResolver'
import type { PeriodScoreRow } from '@/lib/guillotine/types'

/**
 * The `random` tiebreak used `Math.random()`, so the commissioner's chop preview and the real chop each
 * drew their own coin and could name different teams for the same tie — and a rerun of the same week
 * could chop someone else. The draw is now seeded by the week and the tied teams.
 */
const row = (rosterId: string, periodPoints: number, seasonPointsCumul = 100): PeriodScoreRow => ({ rosterId, periodPoints, seasonPointsCumul })

const tiedField = [row('roster-a', 80), row('roster-b', 80), row('roster-c', 80), row('roster-d', 120)]

const chop = (candidates: PeriodScoreRow[], week: number, random?: () => number) =>
  resolveTiebreak({ candidates, tiebreakerOrder: ['random'], teamsPerChop: 1, weekOrPeriod: week, draftSlotByRoster: new Map(), random })

describe('guillotine random tiebreak', () => {
  it('draws the same team every time the same tie is resolved', () => {
    const first = chop(tiedField, 7)
    expect(first.stepUsed).toBe('random')
    for (let i = 0; i < 20; i += 1) expect(chop(tiedField, 7).choppedRosterIds).toEqual(first.choppedRosterIds)
  })

  it('does not depend on the order the caller lists the candidates in', () => {
    // The preview builds candidates from its team list, the engine from evaluator scores — different orders.
    expect(chop([...tiedField].reverse(), 7).choppedRosterIds).toEqual(chop(tiedField, 7).choppedRosterIds)
  })

  it('never draws a team that was not tied on the line', () => {
    for (let week = 1; week <= 50; week += 1) {
      expect(['roster-a', 'roster-b', 'roster-c']).toContain(chop(tiedField, week).choppedRosterIds[0])
    }
  })

  it('is still a fair draw across weeks', () => {
    const counts: Record<string, number> = {}
    const weeks = 600
    for (let week = 1; week <= weeks; week += 1) {
      const [loser] = chop([row('x1', 50), row('x2', 50)], week).choppedRosterIds
      counts[loser!] = (counts[loser!] ?? 0) + 1
    }
    expect(counts.x1! / weeks).toBeGreaterThan(0.4)
    expect(counts.x2! / weeks).toBeGreaterThan(0.4)
  })

  it('uses the caller’s random source when one is given', () => {
    const low = chop(tiedField, 7, () => 0).choppedRosterIds
    const high = chop(tiedField, 7, () => 0.999).choppedRosterIds
    expect(low).not.toEqual(high)
  })

  it('leaves non-random steps exactly as they were', () => {
    const result = resolveTiebreak({
      candidates: [row('a', 80, 300), row('b', 80, 250)],
      tiebreakerOrder: ['season_points', 'random'],
      teamsPerChop: 1,
      weekOrPeriod: 4,
      draftSlotByRoster: new Map(),
    })
    expect(result).toMatchObject({ choppedRosterIds: ['b'], stepUsed: 'season_points' })
  })
})
