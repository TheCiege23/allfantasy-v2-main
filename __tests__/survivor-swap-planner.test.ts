import { describe, expect, it } from 'vitest'
import { isNewTribeKey, patternTribeCount, planTribeSwap } from '@/lib/survivor/survivorSwapPlanner'

const two = [
  { tribeId: 'scorps', rosterIds: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] },
  { tribeId: 'shrooms', rosterIds: ['r7', 'r8', 'r9', 'r10', 'r11', 'r12'] },
]
const noShuffle = () => 0
const all = (after: { rosterIds: string[] }[]) => after.flatMap((t) => t.rosterIds).sort()

describe('planTribeSwap', () => {
  it('2 → 3 tribes: keeps both tribes, adds one sealed new tribe, everyone placed once', () => {
    const plan = planTribeSwap({ before: two, swap: { mode: 'resize', tribeCount: 3 }, randomIndex: noShuffle })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.after.map((t) => t.tribeId)).toEqual(['scorps', 'shrooms', 'new:1'])
    expect(plan.after.map((t) => t.rosterIds.length)).toEqual([4, 4, 4])
    expect(all(plan.after)).toEqual(all(two))
    expect(plan.created).toBe(1)
    expect(plan.retire).toEqual([])
    expect(isNewTribeKey('new:1')).toBe(true)
  })

  it('3 → 2 tribes retires the third', () => {
    const three = [...two.map((t) => ({ ...t, rosterIds: t.rosterIds.slice(0, 4) })), { tribeId: 'squids', rosterIds: ['r13', 'r14', 'r15', 'r16'] }]
    const plan = planTribeSwap({ before: three, swap: { mode: 'resize', tribeCount: 2 }, randomIndex: noShuffle })
    expect(plan.ok && plan.retire).toEqual(['squids'])
    expect(plan.ok && plan.after.map((t) => t.rosterIds.length)).toEqual([6, 6])
  })

  it('refuses a resize the cast cannot fill', () => {
    expect(planTribeSwap({ before: [{ tribeId: 'a', rosterIds: ['r1', 'r2', 'r3'] }, { tribeId: 'b', rosterIds: ['r4', 'r5'] }], swap: { mode: 'resize', tribeCount: 3 }, randomIndex: noShuffle }).ok).toBe(false)
  })

  it('back to the original tribes: OG Scorps and Shrooms, a folded tribe returns, a newcomer joins the smaller tribe', () => {
    const original = [{ tribeId: 'scorps', rosterIds: ['r1', 'r2', 'r3', 'r4'] }, { tribeId: 'shrooms', rosterIds: ['r5', 'r6', 'r7', 'r8'] }]
    // After a 2 → 3 swap, and r4 voted out; r9 came back from Exile and never had an original tribe.
    const now = [{ tribeId: 'shrooms', rosterIds: ['r1', 'r5', 'r9'] }, { tribeId: 'squids', rosterIds: ['r2', 'r6', 'r7'] }, { tribeId: 'scorpsX', rosterIds: ['r3', 'r8'] }]
    const plan = planTribeSwap({ before: now, original, swap: { mode: 'return_to_original' }, randomIndex: noShuffle })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.after).toEqual([{ tribeId: 'scorps', rosterIds: ['r1', 'r2', 'r3', 'r9'] }, { tribeId: 'shrooms', rosterIds: ['r5', 'r6', 'r7', 'r8'] }])
    expect(plan.retire.sort()).toEqual(['scorpsX', 'squids'])
  })

  it('a custom pattern deals the cast in season-point order and can add tribes', () => {
    const points = new Map(two.flatMap((t) => t.rosterIds).map((id, i) => [id, 100 - i]))
    const plan = planTribeSwap({ before: two, swap: { mode: 'custom_pattern', pattern: 'ABCCBA', order: 'season_points' }, seasonPoints: points, randomIndex: noShuffle })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(patternTribeCount('ABCCBA')).toBe(3)
    expect(plan.after.map((t) => t.tribeId)).toEqual(['scorps', 'shrooms', 'new:1'])
    // r1 (most points) → A, r2 → B, r3 → C, r4 → C, r5 → B, r6 → A, then the pattern repeats.
    expect(plan.after[0]!.rosterIds.slice(0, 2)).toEqual(['r1', 'r6'])
    expect(plan.after[2]!.rosterIds.slice(0, 2)).toEqual(['r3', 'r4'])
  })

  it('refuses a plan that would leave a tribe empty', () => {
    expect(planTribeSwap({ before: two, swap: { mode: 'custom_pattern', pattern: 'AC', order: 'random' }, randomIndex: noShuffle }).ok).toBe(false)
  })
})
