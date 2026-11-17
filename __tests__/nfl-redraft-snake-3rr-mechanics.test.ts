/**
 * NFL redraft snake draft — pick mechanics + 3RR behavior lock (Commit G).
 *
 * The canonical `getSlotInRoundForOverall` resolver in
 * `lib/live-draft-engine/DraftOrderService.ts` has been the single source of
 * truth for snake/3RR for several slices — see
 * `__tests__/draft/pick-order-mechanics.test.ts`. This file is a
 * dashboard-side regression-lock that exercises the canonical resolver on the
 * NFL redraft fixture (12-team, 16-round) so a future refactor on the league
 * dashboard branch can't silently drift the contract:
 *
 *   - standard snake: R1 1→12, R2 12→1, R3 1→12, R4 12→1, …
 *   - 3RR: R1 1→12, R2 12→1, R3 12→1, R4 1→12, R5 12→1, …
 *
 * The 3RR variant is what the audit + Commit E referenced as the
 * "thirdRoundReversal" knob on `DraftSession`; this lock pins the slot math
 * end-to-end so anyone touching the resolver sees the failure here as well
 * as in the lower-level engine tests.
 */

import { describe, expect, it } from 'vitest'
import { getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'

const TEAM_COUNT = 12

function slotsForRound(round: number, thirdRoundReversal: boolean): number[] {
  const out: number[] = []
  for (let pickInRound = 1; pickInRound <= TEAM_COUNT; pickInRound += 1) {
    const overall = (round - 1) * TEAM_COUNT + pickInRound
    out.push(
      getSlotInRoundForOverall({
        overall,
        teamCount: TEAM_COUNT,
        draftType: 'snake',
        thirdRoundReversal,
      }),
    )
  }
  return out
}

describe('Standard snake order (12-team, no 3RR)', () => {
  it('R1 runs 1→12 forward', () => {
    expect(slotsForRound(1, false)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
  it('R2 reverses to 12→1', () => {
    expect(slotsForRound(2, false)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })
  it('R3 forward again 1→12', () => {
    expect(slotsForRound(3, false)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
  it('R4 reverse again 12→1', () => {
    expect(slotsForRound(4, false)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })
  it('R16 (last round of a 16-round redraft) reverses since round number is even', () => {
    expect(slotsForRound(16, false)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })
})

describe('Third-round reversal (3RR) order (12-team, thirdRoundReversal=true)', () => {
  it('R1 runs 1→12 forward (same as standard snake)', () => {
    expect(slotsForRound(1, true)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
  it('R2 reverses to 12→1 (same as standard snake)', () => {
    expect(slotsForRound(2, true)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })
  it('R3 reverses AGAIN — slot 1 of round 3 is the team that picked 12th overall', () => {
    // The defining feature of 3RR: the pick-1.12 manager gets the back-to-
    // back 2.01 + 3.01 picks. Slot order in round 3 is 12→1.
    expect(slotsForRound(3, true)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })
  it('R4 forward (1→12) — alternation continues from the 3RR-shifted base', () => {
    expect(slotsForRound(4, true)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
  it('R5 reverse (12→1)', () => {
    expect(slotsForRound(5, true)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })
})
