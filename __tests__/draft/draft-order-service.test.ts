/**
 * Phase 1 — Draft order matrix tests.
 *
 * Locks the snake / linear / third-round-reversal pick-order math in
 * `lib/live-draft-engine/DraftOrderService.ts`. No DB, no Prisma — pure
 * unit tests so a regression here fails the suite in <1s.
 *
 * Matrix coverage requested for the gameplay QA branch:
 *   - 4-team snake, 3 rounds       → 1,2,3,4 / 4,3,2,1 / 1,2,3,4
 *   - 4-team linear, 3 rounds      → 1,2,3,4 / 1,2,3,4 / 1,2,3,4
 *   - 12-team snake (real prod size)
 *   - 12-team linear (real prod size)
 *   - 12-team snake with third-round reversal
 *   - rosterId resolution per pick from a slot order
 *   - upcoming pick owners stop at totalPicks
 *   - pick label formatting (1.01, 2.12, …)
 */
import { describe, expect, it } from 'vitest'
import {
  formatPickLabel,
  getRosterIdForOverall,
  getSlotInRoundForOverall,
  getUpcomingPickOwners,
} from '@/lib/live-draft-engine/DraftOrderService'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'

function slotsForRound(
  round: number,
  teamCount: number,
  draftType: 'snake' | 'linear' | 'auction',
  thirdRoundReversal = false,
): number[] {
  const out: number[] = []
  const startOverall = (round - 1) * teamCount + 1
  for (let i = 0; i < teamCount; i += 1) {
    out.push(
      getSlotInRoundForOverall({
        overall: startOverall + i,
        teamCount,
        draftType,
        thirdRoundReversal,
      }),
    )
  }
  return out
}

describe('getSlotInRoundForOverall — 4-team / 3-round canonical', () => {
  it('snake order: 1,2,3,4 / 4,3,2,1 / 1,2,3,4', () => {
    expect(slotsForRound(1, 4, 'snake')).toEqual([1, 2, 3, 4])
    expect(slotsForRound(2, 4, 'snake')).toEqual([4, 3, 2, 1])
    expect(slotsForRound(3, 4, 'snake')).toEqual([1, 2, 3, 4])
  })

  it('linear order: same direction every round', () => {
    expect(slotsForRound(1, 4, 'linear')).toEqual([1, 2, 3, 4])
    expect(slotsForRound(2, 4, 'linear')).toEqual([1, 2, 3, 4])
    expect(slotsForRound(3, 4, 'linear')).toEqual([1, 2, 3, 4])
  })
})

describe('getSlotInRoundForOverall — 12-team / production size', () => {
  it('snake: round 1 ascending, round 2 descending, round 3 ascending', () => {
    expect(slotsForRound(1, 12, 'snake')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(slotsForRound(2, 12, 'snake')).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(slotsForRound(3, 12, 'snake')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('linear: ascending in every round', () => {
    expect(slotsForRound(1, 12, 'linear')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(slotsForRound(2, 12, 'linear')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(slotsForRound(3, 12, 'linear')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
})

describe('getSlotInRoundForOverall — third-round reversal (3RR)', () => {
  it('rounds 2 and 3 reverse, round 4 returns to ascending, round 5 reverses', () => {
    const r1 = slotsForRound(1, 12, 'snake', true)
    const r2 = slotsForRound(2, 12, 'snake', true)
    const r3 = slotsForRound(3, 12, 'snake', true)
    const r4 = slotsForRound(4, 12, 'snake', true)
    const r5 = slotsForRound(5, 12, 'snake', true)
    expect(r1).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(r2).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(r3).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(r4).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(r5).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('3RR is a no-op for linear drafts', () => {
    expect(slotsForRound(2, 12, 'linear', true)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(slotsForRound(3, 12, 'linear', true)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
})

describe('getRosterIdForOverall', () => {
  const slotOrder: SlotOrderEntry[] = [
    { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
    { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
    { slot: 3, rosterId: 'roster-3', displayName: 'Gamma' },
    { slot: 4, rosterId: 'roster-4', displayName: 'Delta' },
  ]

  it('snake: round 1 walks 1→4, round 2 walks 4→1', () => {
    expect(getRosterIdForOverall(1, 4, 'snake', false, slotOrder)?.rosterId).toBe('roster-1')
    expect(getRosterIdForOverall(4, 4, 'snake', false, slotOrder)?.rosterId).toBe('roster-4')
    expect(getRosterIdForOverall(5, 4, 'snake', false, slotOrder)?.rosterId).toBe('roster-4')
    expect(getRosterIdForOverall(8, 4, 'snake', false, slotOrder)?.rosterId).toBe('roster-1')
    expect(getRosterIdForOverall(9, 4, 'snake', false, slotOrder)?.rosterId).toBe('roster-1')
  })

  it('linear: every round walks 1→4', () => {
    expect(getRosterIdForOverall(1, 4, 'linear', false, slotOrder)?.rosterId).toBe('roster-1')
    expect(getRosterIdForOverall(5, 4, 'linear', false, slotOrder)?.rosterId).toBe('roster-1')
    expect(getRosterIdForOverall(9, 4, 'linear', false, slotOrder)?.rosterId).toBe('roster-1')
    expect(getRosterIdForOverall(8, 4, 'linear', false, slotOrder)?.rosterId).toBe('roster-4')
  })

  it('returns null when slot is missing from slotOrder', () => {
    const sparse: SlotOrderEntry[] = [
      { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
      // no slot 2/3/4
    ]
    expect(getRosterIdForOverall(2, 4, 'snake', false, sparse)).toBeNull()
  })
})

describe('getUpcomingPickOwners', () => {
  const slotOrder: SlotOrderEntry[] = [
    { slot: 1, rosterId: 'r1', displayName: 'A' },
    { slot: 2, rosterId: 'r2', displayName: 'B' },
    { slot: 3, rosterId: 'r3', displayName: 'C' },
    { slot: 4, rosterId: 'r4', displayName: 'D' },
  ]
  const totalPicks = 12 // 4 teams × 3 rounds

  it('walks the snake correctly across the round break', () => {
    const upcoming = getUpcomingPickOwners(3, 4, 4, 'snake', false, slotOrder, totalPicks)
    // Overall 3 → slot 3 (ascending), 4 → slot 4 (ascending), 5 → slot 4 (descending), 6 → slot 3.
    expect(upcoming.map((u) => u.slot)).toEqual([3, 4, 4, 3])
    expect(upcoming.map((u) => u.rosterId)).toEqual(['r3', 'r4', 'r4', 'r3'])
  })

  it('walks linear in a straight line', () => {
    const upcoming = getUpcomingPickOwners(3, 6, 4, 'linear', false, slotOrder, totalPicks)
    expect(upcoming.map((u) => u.slot)).toEqual([3, 4, 1, 2, 3, 4])
  })

  it('stops at totalPicks', () => {
    // Overall 11 → round 3 → ascending → slot 3; 12 → slot 4. 13/14/15 are past totalPicks.
    const upcoming = getUpcomingPickOwners(11, 5, 4, 'snake', false, slotOrder, totalPicks)
    expect(upcoming).toHaveLength(2)
    expect(upcoming.map((u) => u.slot)).toEqual([3, 4])
  })
})

describe('formatPickLabel', () => {
  it('formats with two-digit pick-in-round', () => {
    expect(formatPickLabel(1, 12)).toBe('1.01')
    expect(formatPickLabel(12, 12)).toBe('1.12')
    expect(formatPickLabel(13, 12)).toBe('2.01')
    expect(formatPickLabel(24, 12)).toBe('2.12')
    expect(formatPickLabel(25, 12)).toBe('3.01')
  })

  it('handles 4-team boards', () => {
    expect(formatPickLabel(5, 4)).toBe('2.01')
    expect(formatPickLabel(8, 4)).toBe('2.04')
    expect(formatPickLabel(9, 4)).toBe('3.01')
  })
})
