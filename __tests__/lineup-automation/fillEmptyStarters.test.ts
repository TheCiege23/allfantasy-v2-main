/**
 * Fill an empty starting spot before lock (phase 7, 2026-10-29): only empty spots are filled, every
 * starter the manager chose stays put, and a spot nobody can play is reported instead of guessed at.
 */
import { describe, expect, it } from 'vitest'
import { emptyStarterSlots, fillEmptyStartersOn, planFillEmptyStarters, FILL_EMPTY_STARTERS_KEY } from '@/lib/lineup-automation/fillEmptyStarters'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'

const slot = (index: number, label: string, allowedPositions: string[]) => ({ index, label, allowedPositions, isFlexible: allowedPositions.length > 1 })
const SLOTS = [slot(0, 'QB', ['QB']), slot(1, 'RB', ['RB']), slot(2, 'TE', ['TE']), slot(3, 'FLEX', ['RB', 'WR', 'TE'])]
const row = (id: string, position: string, slotIndex?: number) => ({ id, position, ...(slotIndex != null ? { slotIndex } : {}) })
const playerData = (starters: ReturnType<typeof row>[], bench: ReturnType<typeof row>[]) => ({ lineup_sections: { starters, bench, ir: [], taxi: [], devy: [] } })
const proj = (pts: Record<string, number | null>) => Object.fromEntries(Object.entries(pts).map(([id, p]) => [id, { projectedPoints: p }]))
const no = () => false

describe('planFillEmptyStarters', () => {
  it('fills only the empty spots and leaves every starter where the manager put him', () => {
    // qb-bye is on bye and te-low is weak, but both are the manager's choices.
    const pd = playerData([row('qb-bye', 'QB', 0), row('te-low', 'TE', 2)], [row('rb-a', 'RB'), row('rb-b', 'RB'), row('qb2', 'QB')])
    const plan = planFillEmptyStarters({ slots: SLOTS, playerData: pd, players: proj({ 'qb-bye': 20, 'te-low': 2, 'rb-a': 14, 'rb-b': 9, qb2: 18 }), isLocked: no, onBye: (id) => id === 'qb-bye' })
    if (plan.kind !== 'set') throw new Error(`expected a fill, got ${plan.kind}`)
    expect(plan.changes).toEqual([{ slot: 'RB', in: 'rb-a' }, { slot: 'FLEX', in: 'rb-b' }])
    expect(plan.unfilled).toEqual([])
    const s = getNormalizedLineupSections(plan.nextPlayerData)
    expect(s.starters.map((r) => [r.id, r.slotIndex])).toEqual([['qb-bye', 0], ['rb-a', 1], ['te-low', 2], ['rb-b', 3]])
    expect(s.bench.map((r) => r.id)).toEqual(['qb2'])
  })

  it('fills the hardest spot first, so the FLEX does not take the only tight end', () => {
    // FLEX comes before TE in this league's slot order; filling in order would seat the tight end there.
    const flexFirst = [slot(0, 'QB', ['QB']), slot(1, 'FLEX', ['RB', 'WR', 'TE']), slot(2, 'TE', ['TE'])]
    const pd = playerData([row('qb', 'QB', 0)], [row('te', 'TE'), row('wr', 'WR')])
    const plan = planFillEmptyStarters({ slots: flexFirst, playerData: pd, players: proj({ qb: 20, te: 15, wr: 8 }), isLocked: no, onBye: no })
    if (plan.kind !== 'set') throw new Error(`expected a fill, got ${plan.kind}`)
    expect(plan.changes).toEqual([{ slot: 'FLEX', in: 'wr' }, { slot: 'TE', in: 'te' }])
  })

  it('fills what it can and reports the spot nobody on the bench can play', () => {
    const pd = playerData([row('qb', 'QB', 0)], [row('rb', 'RB')])
    const plan = planFillEmptyStarters({ slots: SLOTS, playerData: pd, players: proj({ qb: 20, rb: 12 }), isLocked: no, onBye: no })
    if (plan.kind !== 'set') throw new Error(`expected a fill, got ${plan.kind}`)
    expect(plan.changes).toEqual([{ slot: 'RB', in: 'rb' }])
    expect(plan.unfilled.sort()).toEqual(['FLEX', 'TE'])
  })

  it('never brings in a bench player whose game has started or who is on bye', () => {
    const pd = playerData([row('qb', 'QB', 0), row('te', 'TE', 2), row('wr', 'WR', 3)], [row('rb-started', 'RB'), row('rb-bye', 'RB')])
    const plan = planFillEmptyStarters({ slots: SLOTS, playerData: pd, players: proj({ qb: 20, te: 5, wr: 7, 'rb-started': 10, 'rb-bye': 30 }), isLocked: (id) => id === 'rb-started', onBye: (id) => id === 'rb-bye' })
    expect(plan).toEqual({ kind: 'cannot_fill', unfilled: ['RB'] })
  })

  it('a bench player with no projection still beats an empty spot', () => {
    const pd = playerData([row('qb', 'QB', 0), row('te', 'TE', 2), row('wr', 'WR', 3)], [row('rb-new', 'RB')])
    const plan = planFillEmptyStarters({ slots: SLOTS, playerData: pd, players: proj({ qb: 20, te: 5, wr: 7, 'rb-new': null }), isLocked: no, onBye: no })
    expect(plan.kind === 'set' && plan.changes).toEqual([{ slot: 'RB', in: 'rb-new' }])
  })

  it('does nothing to a full lineup', () => {
    const pd = playerData([row('qb', 'QB', 0), row('rb', 'RB', 1), row('te', 'TE', 2), row('wr', 'WR', 3)], [row('rb2', 'RB')])
    expect(emptyStarterSlots(pd, SLOTS.length)).toEqual([])
    expect(planFillEmptyStarters({ slots: SLOTS, playerData: pd, players: proj({ rb2: 40 }), isLocked: no, onBye: no })).toEqual({ kind: 'skip', reason: 'no_empty_starters' })
  })
})

describe('the commissioner switch', () => {
  it('is on unless the commissioner switched it off', () => {
    expect(fillEmptyStartersOn(null)).toBe(true)
    expect(fillEmptyStartersOn({})).toBe(true)
    expect(fillEmptyStartersOn({ [FILL_EMPTY_STARTERS_KEY]: true })).toBe(true)
    expect(fillEmptyStartersOn({ [FILL_EMPTY_STARTERS_KEY]: false })).toBe(false)
  })
})
