import { describe, expect, it } from 'vitest'
import { planBestLineup, readManagedLineups, suggestInactiveTeams } from '@/lib/inactive-manager/inactiveManagerMode'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'

const slot = (index: number, label: string, allowedPositions: string[]) => ({ index, label, allowedPositions, isFlexible: allowedPositions.length > 1 })
const SLOTS = [slot(0, 'QB', ['QB']), slot(1, 'RB', ['RB']), slot(2, 'FLEX', ['RB', 'WR', 'TE'])]

const row = (id: string, position: string, slotIndex?: number) => ({ id, position, ...(slotIndex != null ? { slotIndex } : {}) })
const playerData = (starters: ReturnType<typeof row>[], bench: ReturnType<typeof row>[], ir: ReturnType<typeof row>[] = []) => ({
  lineup_sections: { starters, bench, ir, taxi: [], devy: [] },
})
const proj = (pts: Record<string, number | null>) => Object.fromEntries(Object.entries(pts).map(([id, p]) => [id, { projectedPoints: p }]))
const unlocked = () => false

describe('planBestLineup', () => {
  // qb1 starts; rb-hurt (0 proj, ruled out) starts at RB; wr-good sits on the bench.
  const pd = playerData([row('qb1', 'QB', 0), row('rb-hurt', 'RB', 1), row('wr-meh', 'WR', 2)], [row('rb-good', 'RB'), row('wr-good', 'WR')], [row('ir1', 'RB')])
  const pts = proj({ qb1: 20, 'rb-hurt': 0, 'wr-meh': 6, 'rb-good': 12, 'wr-good': 14, ir1: 25 })

  it('starts the projected-best players, seats them by slot, and never touches IR', () => {
    const plan = planBestLineup({ slots: SLOTS, playerData: pd, players: pts, isLocked: unlocked })
    if (plan.kind !== 'set') throw new Error(`expected a lineup, got ${plan.reason}`)
    const s = getNormalizedLineupSections(plan.nextPlayerData)
    expect(s.starters.map((r) => [r.id, r.slotIndex])).toEqual([['qb1', 0], ['rb-good', 1], ['wr-good', 2]])
    expect(s.bench.map((r) => r.id).sort()).toEqual(['rb-hurt', 'wr-meh'])
    expect(s.bench.every((r) => r.slotIndex === undefined)).toBe(true)
    expect(s.ir.map((r) => r.id)).toEqual(['ir1'])
    expect(plan.changes).toEqual([{ slot: 'RB', in: 'rb-good', out: 'rb-hurt' }, { slot: 'FLEX', in: 'wr-good', out: 'wr-meh' }])
  })

  it('never moves a player whose game has started', () => {
    // rb-hurt is locked in his RB slot: only FLEX can change.
    const plan = planBestLineup({ slots: SLOTS, playerData: pd, players: pts, isLocked: (id) => id === 'rb-hurt' })
    if (plan.kind !== 'set') throw new Error('expected a lineup')
    const s = getNormalizedLineupSections(plan.nextPlayerData)
    expect(s.starters.find((r) => r.slotIndex === 1)?.id).toBe('rb-hurt')
    expect(s.starters.find((r) => r.slotIndex === 2)?.id).toBe('wr-good')
  })

  it('leaves the lineup alone when it is already the best', () => {
    const best = playerData([row('qb1', 'QB', 0), row('rb-good', 'RB', 1), row('wr-good', 'WR', 2)], [row('rb-hurt', 'RB'), row('wr-meh', 'WR')])
    expect(planBestLineup({ slots: SLOTS, playerData: best, players: pts, isLocked: unlocked })).toEqual({ kind: 'skip', reason: 'already_best' })
  })

  it('does not guess when too many players have no projection', () => {
    const sparse = proj({ qb1: 20, 'rb-hurt': null, 'wr-meh': null, 'rb-good': 12, 'wr-good': null })
    expect(planBestLineup({ slots: SLOTS, playerData: pd, players: sparse, isLocked: unlocked })).toEqual({ kind: 'skip', reason: 'projections_missing' })
  })

  it('reports a league with no starter slots', () => {
    expect(planBestLineup({ slots: [], playerData: pd, players: pts, isLocked: unlocked })).toEqual({ kind: 'skip', reason: 'no_slots' })
  })
})

describe('managed teams and suggestions', () => {
  it('reads only well-formed entries', () => {
    expect(readManagedLineups({ af_managed_lineups: { r1: { since: 'x', byUserId: 'c' }, r2: { since: 1 }, r3: null } })).toEqual({ r1: { since: 'x', byUserId: 'c' } })
    expect(readManagedLineups(null)).toEqual({})
  })

  it('suggests inactive teams that are not already managed, and nothing else', () => {
    const rows = [
      { rosterId: 'a', status: 'inactive' as const },
      { rosterId: 'b', status: 'inactive' as const },
      { rosterId: 'c', status: 'at_risk' as const },
      { rosterId: 'd', status: 'unknown' as const },
    ]
    expect(suggestInactiveTeams(rows, { b: { since: 'x', byUserId: 'c' } })).toEqual(['a'])
  })
})
