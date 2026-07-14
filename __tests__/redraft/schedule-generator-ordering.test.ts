import { describe, expect, it } from 'vitest'
import { generateSchedule } from '@/lib/redraft/scheduleEngine'

/**
 * The finalizer feeds rosters into generateSchedule ordered by id (cuid) — see
 * ensureScheduleForNewSeason in lib/redraft/finalizeDraftToRedraftSeason.ts. These
 * tests pin the generator's determinism: the same ordered roster list must always
 * yield the same matchup slots, and every team must be paired exactly once per week.
 */
describe('redraft schedule generator ordering', () => {
  const rosters = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r-${i + 1}` }))

  it('is deterministic for a fixed roster order', () => {
    const a = generateSchedule(rosters(4), 14, 14, 'NFL')
    const b = generateSchedule(rosters(4), 14, 14, 'NFL')
    expect(a).toEqual(b)
  })

  it('pairs every team exactly once per regular week (even count, no byes)', () => {
    const slots = generateSchedule(rosters(4), 14, 14, 'NFL')
    const byWeek = new Map<number, string[]>()
    for (const s of slots) {
      const ids = byWeek.get(s.week) ?? []
      ids.push(s.home)
      if (s.away) ids.push(s.away)
      byWeek.set(s.week, ids)
    }
    for (const ids of byWeek.values()) {
      expect([...ids].sort()).toEqual(['r-1', 'r-2', 'r-3', 'r-4'])
    }
  })

  it('gives exactly one team a bye each week for odd roster counts', () => {
    const ids = ['r-1', 'r-2', 'r-3']
    const slots = generateSchedule(rosters(3), 6, 7, 'NFL')
    const week1 = slots.filter((s) => s.week === 1)
    const present = new Set(week1.flatMap((s) => (s.away ? [s.home, s.away] : [s.home])))
    // 3 teams → one match + one bye row; all three teams appear, none duplicated.
    expect([...present].sort()).toEqual(ids)
    expect(week1.some((s) => s.away === null)).toBe(true)
  })

  it('reordering the input rosters changes the emitted pairings', () => {
    const forward = generateSchedule(rosters(4), 14, 14, 'NFL')
    const reversed = generateSchedule([...rosters(4)].reverse(), 14, 14, 'NFL')
    expect(forward).not.toEqual(reversed)
  })

  it('produces a stable two-team head-to-head schedule (G8 seed shape)', () => {
    const slots = generateSchedule([{ id: 'r-1' }, { id: 'r-2' }], 14, 14, 'NFL')
    const week1 = slots.filter((s) => s.week === 1 && s.type === 'regular')
    expect(week1).toHaveLength(1)
    expect([week1[0]!.home, week1[0]!.away].sort()).toEqual(['r-1', 'r-2'])
  })
})
