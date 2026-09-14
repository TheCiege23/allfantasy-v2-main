// @vitest-environment node
/**
 * `lineupSeatsFromSettings` (2026-09-14): the league's starting seats in the exact
 * optimizer's shape, from the same table `canFillSlot` answers. An unrecognised slot refuses
 * the whole lineup rather than dropping a seat — a smaller best lineup reads as a real one.
 */
import { describe, expect, it } from 'vitest'

import { canFillSlot, lineupSeatsFromSettings } from '@/lib/core-app/slotEligibility'

describe('lineupSeatsFromSettings', () => {
  it('one seat per starting slot, bench/IR/taxi dropped, eligibility from the shared table', () => {
    const seats = lineupSeatsFromSettings({ roster_positions: ['QB', 'RB', 'RB', 'WR', 'FLEX', 'SUPER_FLEX', 'DEF', 'BN', 'IR', 'TAXI'] })
    expect(seats?.map((s) => s.slot)).toEqual(['QB', 'RB', 'RB', 'WR', 'FLEX', 'SUPER_FLEX', 'DEF'])
    expect(seats?.every((s) => s.count === 1)).toBe(true)
    const flex = seats?.find((s) => s.slot === 'FLEX')
    expect(flex?.eligible.sort()).toEqual(['FB', 'RB', 'TE', 'WR'])
    expect(seats?.find((s) => s.slot === 'SUPER_FLEX')?.eligible).toContain('QB')
    // DEF seats a defence stored under either name.
    expect(seats?.find((s) => s.slot === 'DEF')?.eligible.sort()).toEqual(['DEF', 'DST'])
  })

  it('🛑 agrees with canFillSlot for every seat it returns', () => {
    const seats = lineupSeatsFromSettings({ roster_positions: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX', 'IDP_FLEX'] })!
    for (const s of seats) for (const p of s.eligible) expect(canFillSlot(s.slot, p)).toBe(true)
  })

  it('🛑 an unrecognised slot refuses the whole lineup (null), never a lineup missing that seat', () => {
    expect(lineupSeatsFromSettings({ roster_positions: ['QB', 'RB', 'MYSTERY_FLEX'] })).toBeNull()
  })

  it('no slots stored → null', () => {
    expect(lineupSeatsFromSettings({})).toBeNull()
    expect(lineupSeatsFromSettings(null)).toBeNull()
    expect(lineupSeatsFromSettings({ roster_positions: ['BN', 'BN'] })).toBeNull()
  })
})
