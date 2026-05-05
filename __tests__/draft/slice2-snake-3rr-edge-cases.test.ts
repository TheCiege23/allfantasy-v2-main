import { describe, expect, it } from 'vitest'
import { getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Slice 2 — extends the existing pick-order-mechanics + draftOrder coverage
 * with the team-count edge cases the audit flagged: 8, 10, 14 teams, both
 * with and without Third Round Reversal.
 */

function slot(overall: number, teamCount: number, thirdRoundReversal: boolean): number {
  return getSlotInRoundForOverall({
    overall,
    teamCount,
    draftType: 'snake',
    thirdRoundReversal,
  })
}

describe('Slice 2 — snake order with 3RR off, edge team counts', () => {
  for (const teamCount of [8, 10, 14] as const) {
    it(`${teamCount}-team plain snake: rounds alternate`, () => {
      // Round 1 forward
      expect(slot(1, teamCount, false)).toBe(1)
      expect(slot(teamCount, teamCount, false)).toBe(teamCount)
      // Round 2 reversed (12-team logic mirrored for 8/10/14)
      expect(slot(teamCount + 1, teamCount, false)).toBe(teamCount)
      expect(slot(2 * teamCount, teamCount, false)).toBe(1)
      // Round 3 forward
      expect(slot(2 * teamCount + 1, teamCount, false)).toBe(1)
      expect(slot(3 * teamCount, teamCount, false)).toBe(teamCount)
      // Round 4 reversed
      expect(slot(3 * teamCount + 1, teamCount, false)).toBe(teamCount)
      expect(slot(4 * teamCount, teamCount, false)).toBe(1)
      // Round 5 forward
      expect(slot(4 * teamCount + 1, teamCount, false)).toBe(1)
    })
  }
})

describe('Slice 2 — 3RR (rounds 2 & 3 go same direction; round 4 returns to forward)', () => {
  for (const teamCount of [8, 10, 12, 14] as const) {
    it(`${teamCount}-team 3RR: R1 fwd, R2 rev, R3 rev, R4 fwd, R5 rev`, () => {
      // Round 1 forward
      expect(slot(1, teamCount, true)).toBe(1)
      expect(slot(teamCount, teamCount, true)).toBe(teamCount)
      // Round 2 reversed
      expect(slot(teamCount + 1, teamCount, true)).toBe(teamCount)
      expect(slot(2 * teamCount, teamCount, true)).toBe(1)
      // Round 3 reversed (the 3RR mechanic — same direction as R2)
      expect(slot(2 * teamCount + 1, teamCount, true)).toBe(teamCount)
      expect(slot(3 * teamCount, teamCount, true)).toBe(1)
      // Round 4 returns to forward (normal alternating snake from here)
      expect(slot(3 * teamCount + 1, teamCount, true)).toBe(1)
      expect(slot(4 * teamCount, teamCount, true)).toBe(teamCount)
      // Round 5 reversed
      expect(slot(4 * teamCount + 1, teamCount, true)).toBe(teamCount)
      expect(slot(5 * teamCount, teamCount, true)).toBe(1)
      // Round 6 forward
      expect(slot(5 * teamCount + 1, teamCount, true)).toBe(1)
      expect(slot(6 * teamCount, teamCount, true)).toBe(teamCount)
    })
  }

  it('14-team 3RR mid-round slot math is consistent', () => {
    // R3 is reversed in 3RR, so pick 5 of round 3 (overall = 28 + 5 = 33) → slot 14 - 5 + 1 = 10
    expect(slot(33, 14, true)).toBe(10)
    // R4 is forward, so pick 5 of round 4 (overall = 42 + 5 = 47) → slot 5
    expect(slot(47, 14, true)).toBe(5)
  })

  it('3RR off vs on: rounds 1–2 identical, rounds 3+ mirror each round', () => {
    // Without 3RR: pattern is fwd, rev, fwd, rev, fwd, rev, ... (R1, R3, R5 forward; R2, R4, R6 reversed)
    // With 3RR:    pattern is fwd, rev, rev, fwd, rev, fwd, rev, ... (R3 doubles the reverse, then alternates)
    // Net effect: from round 3 onwards, every round is mirrored vs the no-3RR slot.
    const teamCount = 12
    for (let r = 1; r <= 8; r += 1) {
      for (let p = 1; p <= teamCount; p += 1) {
        const overall = (r - 1) * teamCount + p
        const off = slot(overall, teamCount, false)
        const on = slot(overall, teamCount, true)
        if (r <= 2) {
          expect(on, `R${r}.${p}`).toBe(off)
        } else {
          expect(on, `R${r}.${p}`).toBe(teamCount - off + 1)
        }
      }
    }
  })
})

describe('Slice 2 — legacy runtime write path stays 3RR-aware', () => {
  const executePickSource = readFileSync(
    resolve(process.cwd(), 'lib/draft/execute-pick.ts'),
    'utf8',
  )

  it('uses canonical getSlotInRoundForOverall for on-clock slot resolution', () => {
    expect(executePickSource).toMatch(/getSlotInRoundForOverall\s*\(\s*\{[\s\S]*overall:\s*overallPick/)
  })

  it('reads thirdRoundReversal from draft room state in legacy mock flow', () => {
    expect(executePickSource).toMatch(/state as \{ thirdRoundReversal\?: boolean \| null \}/)
    expect(executePickSource).toMatch(/thirdRoundReversal/)
  })
})
