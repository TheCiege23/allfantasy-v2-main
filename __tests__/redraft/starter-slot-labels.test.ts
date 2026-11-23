/**
 * Starter labels that fit the league's layout (lib/redraft/starterSlotLabels.ts). Labels only — who starts
 * never changes — checked against the validator itself, so a relabelled lineup is one it accepts.
 */
import { describe, expect, it } from 'vitest'
import { starterSlotLabelChanges, type LabelledStarter } from '@/lib/redraft/starterSlotLabels'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { validateRedraftLineup } from '@/lib/redraft/lineupValidation'

// The owner's 8-team league: QB RB RB WR WR TE FLX K DEF.
const EIGHT = resolveRedraftRosterConfig('NFL', { starter_slots: { K: 1, QB: 1, RB: 2, TE: 1, WR: 2, DEF: 1, FLX: 1 } })
// Zombie Chimmy Test: QB RB RB WR WR TE FLEX FLEX, no K or DEF.
const ZOMBIE = resolveRedraftRosterConfig('NFL', { roster: { config: { sections: [{ key: 'primary', slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, K: 0, DEF: 0, BN: 3 } }] } } })

const LABEL_CODES = new Set(['starter_slot_overflow', 'missing_starter_slot', 'starter_position_ineligible', 'illegal_lineup_slot'])
const row = (id: string, position: string, slotType: string): LabelledStarter => ({ id, position, slotType })
const apply = (rows: LabelledStarter[], changes: Map<string, string>) => rows.map((r) => ({ ...r, slotType: changes.get(r.id) ?? r.slotType }))
const errors = (rows: LabelledStarter[], cfg: typeof EIGHT) =>
  validateRedraftLineup({ sport: 'NFL', week: 12, rosterConfig: cfg, players: rows.map((r) => ({ playerId: r.id, playerName: r.id, position: r.position ?? '', sport: 'NFL', slotType: r.slotType })) })
    // The slot-label errors only: bench size and roster maximum are not what a label can fix.
    .issues.filter((i) => i.severity === 'error' && LABEL_CODES.has(i.code)).map((i) => i.code)

describe('starterSlotLabelChanges', () => {
  it('relabels a third RB stored as "RB" to the FLX, and the validator then accepts the lineup', () => {
    const rows = [
      row('qb', 'QB', 'QB'), row('rb1', 'RB', 'RB'), row('rb2', 'RB', 'RB'), row('rb3', 'RB', 'RB'),
      row('wr1', 'WR', 'WR'), row('wr2', 'WR', 'WR'), row('te', 'TE', 'TE'), row('k', 'K', 'K'), row('def', 'DEF', 'DEF'),
      row('bn', 'WR', 'bench'),
    ]
    expect(errors(rows, EIGHT)).toContain('starter_slot_overflow')
    const changes = starterSlotLabelChanges('NFL', rows, EIGHT.starterCapacities)
    expect([...changes.values()]).toEqual(['FLX'])
    expect(errors(apply(rows, changes), EIGHT)).toEqual([])
  })

  // The league stores FLEX; the validator's token for it is FLX (normalizeToken), so FLX is what is written.
  it('fills BOTH zombie FLEX spots when four RBs are labelled "RB" (the owner’s zombie team)', () => {
    const rows = [
      row('hurts', 'QB', 'QB'), row('achane', 'RB', 'RB'), row('tuten', 'RB', 'RB'), row('hall', 'RB', 'RB'), row('taylor', 'RB', 'RB'),
      row('nabers', 'WR', 'WR'), row('mcconkey', 'WR', 'WR'), row('loveland', 'TE', 'TE'),
    ]
    const changes = starterSlotLabelChanges('NFL', rows, ZOMBIE.starterCapacities)
    expect([...changes.values()].sort()).toEqual(['FLX', 'FLX'])
    expect(errors(apply(rows, changes), ZOMBIE)).toEqual([])
  })

  it('[control] treats a stored "FLEX" label as the FLX it normalizes to, and changes nothing', () => {
    const rows = [
      row('hurts', 'QB', 'QB'), row('achane', 'RB', 'RB'), row('hall', 'RB', 'RB'), row('bijan', 'RB', 'FLEX'),
      row('london', 'WR', 'FLEX'), row('nabers', 'WR', 'WR'), row('mcconkey', 'WR', 'WR'), row('loveland', 'TE', 'TE'),
    ]
    expect(starterSlotLabelChanges('NFL', rows, ZOMBIE.starterCapacities).size).toBe(0)
  })

  it('[control] leaves a legal lineup exactly as it is, including a WR already in FLX', () => {
    const rows = [
      row('qb', 'QB', 'QB'), row('rb1', 'RB', 'RB'), row('rb2', 'RB', 'RB'), row('wr1', 'WR', 'WR'), row('wr2', 'WR', 'WR'),
      row('diggs', 'WR', 'FLX'), row('te', 'TE', 'TE'), row('k', 'K', 'K'), row('def', 'DEF', 'DEF'),
    ]
    expect(starterSlotLabelChanges('NFL', rows, EIGHT.starterCapacities).size).toBe(0)
  })

  it('never touches the bench, and never moves anyone in or out of the lineup', () => {
    const rows = [row('rb1', 'RB', 'RB'), row('rb2', 'RB', 'RB'), row('rb3', 'RB', 'RB'), row('bn1', 'RB', 'bench'), row('ir', 'RB', 'IR')]
    const changes = starterSlotLabelChanges('NFL', rows, EIGHT.starterCapacities)
    expect(changes.has('bn1')).toBe(false)
    expect(changes.has('ir')).toBe(false)
    for (const label of changes.values()) expect(['bench', 'BN', 'IR']).not.toContain(label)
  })

  it('leaves a starter nobody can seat for the validator to report, rather than inventing a slot', () => {
    // Four TEs in a layout with one TE and one FLX: two of them have no slot.
    const rows = [row('t1', 'TE', 'TE'), row('t2', 'TE', 'TE'), row('t3', 'TE', 'TE'), row('t4', 'TE', 'TE')]
    const changes = starterSlotLabelChanges('NFL', rows, EIGHT.starterCapacities)
    expect(changes.size).toBe(1)
    expect([...changes.values()]).toEqual(['FLX'])
  })
})
