import { describe, expect, it } from 'vitest'
import { betaCombatDeadline, betaCombatKind, planBetaAmbush, type CombatRole } from '@/lib/zombie/beta2025CombatPolicy'

describe('2025 combat policy', () => {
  it.each([
    ['2026-10-29T23:00:00Z', '2026-11-05T02:00:00.000Z'],
    ['2026-09-10T23:00:00Z', '2026-09-17T01:00:00.000Z'],
    ['2026-03-05T23:00:00Z', '2026-03-12T01:00:00.000Z'],
  ])('uses Wednesday 9 pm Eastern after %s, across DST', (kickoff, expected) => {
    expect(betaCombatDeadline(new Date(kickoff)).toISOString()).toBe(expected)
  })
  const roles: CombatRole[] = ['Survivor', 'Zombie', 'Whisperer']
  for (const winner of roles) for (const loser of roles) {
    it(`${winner} over ${loser}: exact threshold and choice eligibility`, () => {
      expect(betaCombatKind(winner, loser, 59.99)).toBeNull()
      const expected = winner === 'Survivor' && loser === 'Survivor' ? 'survivor_bash' :
        winner === 'Survivor' && loser === 'Whisperer' ? 'whisperer_bash' : winner === 'Zombie' && loser === 'Whisperer' ? 'whisperer_maul' : null
      expect(betaCombatKind(winner, loser, 60)).toBe(expected)
      expect(betaCombatKind(winner, loser, 100)).toBe(expected)
    })
  }
})

describe('full remap legality', () => {
  const current = [
    { id: 'm1', homeRosterId: 'a', awayRosterId: 'b' }, { id: 'm2', homeRosterId: 'c', awayRosterId: 'd' },
    { id: 'm3', homeRosterId: 'e', awayRosterId: 'f' },
  ]
  it('remaps multiple untouched teams after an unrelated matchup locked', () => {
    expect(planBetaAmbush(current, [current[0], { homeRosterId: 'c', awayRosterId: 'e' }, { homeRosterId: 'd', awayRosterId: 'f' }], new Set(['a']))).toEqual([
      { ...current[0], changed: false }, { id: 'm2', homeRosterId: 'c', awayRosterId: 'e', changed: true }, { id: 'm3', homeRosterId: 'd', awayRosterId: 'f', changed: true },
    ])
  })
  it.each([
    [{ homeRosterId: 'a', awayRosterId: 'c' }, { homeRosterId: 'b', awayRosterId: 'd' }, current[2]],
    [{ homeRosterId: 'a', awayRosterId: 'b' }, { homeRosterId: 'c', awayRosterId: 'a' }, current[2]],
    [{ homeRosterId: 'a', awayRosterId: 'b' }, { homeRosterId: 'c', awayRosterId: 'outside' }, current[2]],
  ])('refuses a locked team, duplicate participant or foreign team', (...pairs) => {
    expect(() => planBetaAmbush(current, pairs, new Set(['a']))).toThrow()
  })
  it('does not charge for reordered rows or home/away-only edits', () => {
    expect(() => planBetaAmbush(current, [current[2], { homeRosterId: 'b', awayRosterId: 'a' }, current[1]], new Set())).toThrow('at least one')
  })
  it('refuses an incomplete plan and a bye', () => {
    expect(() => planBetaAmbush(current, current.slice(0, 2), new Set())).toThrow()
    expect(() => planBetaAmbush(current, [...current.slice(0, 2), { homeRosterId: 'e', awayRosterId: '' }], new Set())).toThrow()
  })
})
