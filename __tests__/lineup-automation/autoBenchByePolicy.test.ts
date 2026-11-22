/**
 * The free "bench my starters on bye automatically" setting (owner decision 2026-10-27): only a starter
 * on bye moves, every other starter stays where the manager put him, and the setting belongs to the
 * owner who turned it on.
 */
import { describe, expect, it } from 'vitest'
import { AUTO_BENCH_BYE_KEY, autoBenchByeOn, planAutoBenchBye, withAutoBenchBye } from '@/lib/lineup-automation/autoBenchByePolicy'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'

const slot = (index: number, label: string, allowedPositions: string[]) => ({ index, label, allowedPositions, isFlexible: allowedPositions.length > 1 })
const SLOTS = [slot(0, 'QB', ['QB']), slot(1, 'RB', ['RB']), slot(2, 'FLEX', ['RB', 'WR', 'TE'])]
const row = (id: string, position: string, slotIndex?: number) => ({ id, position, ...(slotIndex != null ? { slotIndex } : {}) })
const playerData = (starters: ReturnType<typeof row>[], bench: ReturnType<typeof row>[]) => ({ lineup_sections: { starters, bench, ir: [], taxi: [], devy: [] } })
const proj = (pts: Record<string, number | null>) => Object.fromEntries(Object.entries(pts).map(([id, p]) => [id, { projectedPoints: p }]))
const unlocked = () => false

// The manager started wr-meh at FLEX over a better wr-good — his choice, which must stand.
const pd = playerData([row('qb1', 'QB', 0), row('rb-bye', 'RB', 1), row('wr-meh', 'WR', 2)], [row('rb-good', 'RB'), row('rb-also-bye', 'RB'), row('wr-good', 'WR')])
const pts = proj({ qb1: 20, 'rb-bye': 18, 'wr-meh': 6, 'rb-good': 12, 'rb-also-bye': 25, 'wr-good': 14 })
const bye = (id: string) => id === 'rb-bye' || id === 'rb-also-bye'

describe('planAutoBenchBye', () => {
  it('swaps only the starter on bye, for the best bench player who has a game', () => {
    const plan = planAutoBenchBye({ slots: SLOTS, playerData: pd, players: pts, isLocked: unlocked, onBye: bye })
    if (plan.kind !== 'set') throw new Error(`expected a swap, got ${plan.reason}`)
    // rb-also-bye projects higher but is on bye too; wr-meh stays at FLEX though wr-good is better.
    expect(plan.changes).toEqual([{ slot: 'RB', in: 'rb-good', out: 'rb-bye' }])
    const s = getNormalizedLineupSections(plan.nextPlayerData)
    expect(s.starters.map((r) => r.id)).toEqual(['qb1', 'rb-good', 'wr-meh'])
  })

  it('does nothing when no starter is on bye', () => {
    expect(planAutoBenchBye({ slots: SLOTS, playerData: pd, players: pts, isLocked: unlocked, onBye: () => false })).toEqual({ kind: 'skip', reason: 'no_bye_starters' })
  })

  it('leaves a bye starter alone when nobody on the bench can play his slot', () => {
    const thin = playerData([row('qb1', 'QB', 0), row('rb-bye', 'RB', 1), row('wr-meh', 'WR', 2)], [row('rb-also-bye', 'RB'), row('qb2', 'QB')])
    const plan = planAutoBenchBye({ slots: SLOTS, playerData: thin, players: proj({ qb1: 20, 'rb-bye': 18, 'wr-meh': 6, 'rb-also-bye': 25, qb2: 9 }), isLocked: unlocked, onBye: bye })
    expect(plan.kind).toBe('skip')
  })

  it('never brings in a bench player whose game has started', () => {
    const plan = planAutoBenchBye({ slots: SLOTS, playerData: pd, players: pts, isLocked: (id) => id === 'rb-good', onBye: bye })
    expect(plan.kind).toBe('skip')
  })
})

describe('the setting', () => {
  it('counts only while the owner who turned it on still owns the team', () => {
    const settings = withAutoBenchBye({ other: 1 }, true, 'u1', new Date('2026-10-27T00:00:00Z'))
    expect(settings).toEqual({ other: 1, [AUTO_BENCH_BYE_KEY]: { on: true, byUserId: 'u1', since: '2026-10-27T00:00:00.000Z' } })
    expect(autoBenchByeOn(settings, 'u1')).toBe(true)
    expect(autoBenchByeOn(settings, 'new-owner')).toBe(false)
    expect(autoBenchByeOn(null, 'u1')).toBe(false)
  })

  it('turning it off removes it and keeps every other key', () => {
    expect(withAutoBenchBye({ other: 1, [AUTO_BENCH_BYE_KEY]: { on: true, byUserId: 'u1' } }, false, 'u1')).toEqual({ other: 1 })
  })
})
