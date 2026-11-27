// @vitest-environment node
/**
 * `declaredAvailability` — whether a pasted Yahoo league may call anybody available, and whom it must
 * still hide. ONE coverage rule: `bridgeVerdict` (bridgedRosterIds.ts) decides it here and in
 * `loadBridgedLeagues`, so the Player Finder and the waiver screens cannot disagree about a league.
 */
import { describe, expect, it } from 'vitest'

import { declaredAvailability } from '@/lib/core-app/declaredAvailability'
import { BRIDGE_MIN_COVERAGE, loadBridgedLeagues } from '@/lib/core-app/bridgedRosterIds'

const declared = (n: number) => Array.from({ length: n }, (_, i) => `sleeper:${100 + i}`)
const paste = (n: number) => Array.from({ length: n }, (_, i) => `yahoo-paste:player ${i}|WR|KC`)

describe('declaredAvailability', () => {
  it('null for every platform that is not a declared bridge, and for a Yahoo league with no declared id', () => {
    expect(declaredAvailability('sleeper', [{ players: declared(5) }])).toBeNull()
    expect(declaredAvailability('fleaflicker', [{ players: declared(5) }])).toBeNull()
    expect(declaredAvailability('yahoo', [{ players: ['4046', '6038'] }])).toBeNull()
  })

  it(`verified exactly at the ${BRIDGE_MIN_COVERAGE * 100}% bar, not below it`, () => {
    expect(declaredAvailability('yahoo', [{ players: [...declared(8), ...paste(2)] }])).toMatchObject({ verified: true, total: 10, matched: 8, unmatched: 2 })
    expect(declaredAvailability('yahoo', [{ players: [...declared(7), ...paste(3)] }])).toMatchObject({ verified: false, unmatched: 3 })
  })

  it('counts distinct ids across every roster array and every roster', () => {
    const v = declaredAvailability('yahoo', [
      { players: ['sleeper:1', 'yahoo-paste:a|WR|KC'], starters: ['sleeper:1'], reserve: ['yahoo-paste:a|WR|KC'] },
      { players: ['sleeper:2'], taxi: ['sleeper:3'] },
    ])
    expect(v).toMatchObject({ total: 4, matched: 3, unmatched: 1 })
  })

  it('hides the unmatched player by the name his paste id carries, a defence by club — and nobody else', () => {
    const v = declaredAvailability('yahoo', [{ players: [...declared(8), 'yahoo-paste:marvin harrison jr|WR|ARI', 'yahoo-paste:philadelphia|DEF|PHI'] }])!
    expect(v.hides({ name: 'Marvin Harrison Jr.', position: 'WR', team: 'ARI' })).toBe(true)
    expect(v.hides({ name: 'Philadelphia Eagles', position: 'DEF', team: 'PHI' })).toBe(true)
    expect(v.hides({ name: 'Ja’Marr Chase', position: 'WR', team: 'CIN' })).toBe(false)
    expect(v.hides({ name: 'Dallas Cowboys', position: 'DEF', team: 'DAL' })).toBe(false)
  })

  it('a bare Yahoo number is counted as unmatched and hides nothing', () => {
    const v = declaredAvailability('yahoo', [{ players: [...declared(9), '33536'] }])!
    expect(v).toMatchObject({ verified: true, unmatched: 1 })
    expect(v.hides({ name: '33536' })).toBe(false)
  })

  it('agrees with loadBridgedLeagues on the same rosters — one rule, not two', async () => {
    for (const players of [[...declared(8), ...paste(2)], [...declared(7), ...paste(3)], [...declared(1), ...paste(1)]]) {
      const db = { roster: { findMany: async () => [{ leagueId: 'Y1', playerData: { players } }] }, playerIdentityMap: { findMany: async () => [] } }
      const bridged = (await loadBridgedLeagues([{ id: 'Y1', platform: 'yahoo' }], db as never)).get('Y1')!
      const mine = declaredAvailability('yahoo', [{ players }])!
      expect({ readable: bridged.readable, total: bridged.total, translated: bridged.translated }).toEqual({
        readable: mine.verified,
        total: mine.total,
        translated: mine.matched,
      })
    }
  })
})
