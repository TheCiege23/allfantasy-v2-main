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

  it('a bare Yahoo number with no stored name is counted as unmatched and hides nothing', () => {
    const v = declaredAvailability('yahoo', [{ players: [...declared(9), '33536'] }])!
    expect(v).toMatchObject({ verified: true, unmatched: 1 })
    expect(v.hides({ name: '33536' })).toBe(false)
    expect(v.hides({ name: 'Kenneth Walker', position: 'RB', team: 'SEA' })).toBe(false)
  })

  it('a bare Yahoo number hides by the name its roster stored in player_metadata, and is still counted', () => {
    const v = declaredAvailability('yahoo', [
      { players: [...declared(9), '33536'], player_metadata: { '33536': { name: 'Kenneth Walker III', position: 'RB', team: 'SEA' } } },
    ])!
    expect(v).toMatchObject({ verified: true, total: 10, matched: 9, unmatched: 1 })
    expect(v.hides({ name: 'Kenneth Walker', position: 'RB', team: 'SEA' })).toBe(true)
    expect(v.hides({ name: 'Kenneth Gainwell', position: 'RB', team: 'PIT' })).toBe(false)
  })

  describe('a name spelled differently on the two sides still hides (it only ever hides)', () => {
    const league = (...pasted: string[]) => declaredAvailability('yahoo', [{ players: [...declared(20), ...pasted] }])!

    it('a generational suffix on either side', () => {
      expect(league('yahoo-paste:kenneth walker iii|RB|SEA').hides({ name: 'Kenneth Walker', position: 'RB', team: 'SEA' })).toBe(true)
      expect(league('yahoo-paste:kenneth walker|RB|SEA').hides({ name: 'Kenneth Walker III', position: 'RB', team: 'SEA' })).toBe(true)
      expect(league('yahoo-paste:marvin harrison|WR|ARI').hides({ name: 'Marvin Harrison Jr.', position: 'WR', team: 'ARI' })).toBe(true)
    })

    it('a nickname for the given name, same surname ("Mitch" / "Mitchell")', () => {
      expect(league('yahoo-paste:mitch trubisky|QB|PIT').hides({ name: 'Mitchell Trubisky', position: 'QB', team: 'PIT' })).toBe(true)
      expect(league('yahoo-paste:mitchell trubisky|QB|PIT').hides({ name: 'Mitch Trubisky', position: 'QB', team: 'PIT' })).toBe(true)
      // Two letters is not a nickname, and a different surname is a different player.
      expect(league('yahoo-paste:mi trubisky|QB|PIT').hides({ name: 'Mitchell Trubisky', position: 'QB', team: 'PIT' })).toBe(false)
      expect(league('yahoo-paste:mitch trubisky|QB|PIT').hides({ name: 'Mitchell Tenpenny', position: 'QB', team: 'PIT' })).toBe(false)
    })

    it('punctuation: apostrophes, periods, hyphens, curly quotes', () => {
      expect(league("yahoo-paste:ja'marr chase|WR|CIN").hides({ name: 'JaMarr Chase', position: 'WR', team: 'CIN' })).toBe(true)
      expect(league("yahoo-paste:ja'marr chase|WR|CIN").hides({ name: 'Ja’Marr Chase', position: 'WR', team: 'CIN' })).toBe(true)
      expect(league('yahoo-paste:aj brown|WR|PHI').hides({ name: 'A.J. Brown', position: 'WR', team: 'PHI' })).toBe(true)
      expect(league('yahoo-paste:amon-ra st brown|WR|DET').hides({ name: 'Amon-Ra St. Brown', position: 'WR', team: 'DET' })).toBe(true)
    })

    it('accents — the paste id already lost the letter, so the wire row is folded the same way', () => {
      // `normalizePlayerName` (team-abbrev) DROPS a non-ASCII letter: "José" was stored as "jos".
      expect(league('yahoo-paste:jos ramrez|RB|NYJ').hides({ name: 'José Ramírez', position: 'RB', team: 'NYJ' })).toBe(true)
      // With the raw name kept in player_metadata, the unaccented wire spelling hides too.
      const v = declaredAvailability('yahoo', [
        { players: [...declared(20), 'yahoo-paste:jos ramrez|RB|NYJ'], player_metadata: { 'yahoo-paste:jos ramrez|RB|NYJ': { name: 'José Ramírez', position: 'RB', team: 'NYJ' } } },
      ])!
      expect(v.hides({ name: 'Jose Ramirez', position: 'RB', team: 'NYJ' })).toBe(true)
    })

    it('control: a namesake on the OTHER side of the ball is really free and stays listed', () => {
      const v = league('yahoo-paste:josh allen|QB|BUF')
      expect(v.hides({ name: 'Josh Allen', position: 'QB', team: 'BUF' })).toBe(true)
      expect(v.hides({ name: 'Josh Allen', position: 'LB', team: 'JAX' })).toBe(false)
      // No position on the wire row: no claim either way, so he is hidden (the safe direction).
      expect(v.hides({ name: 'Josh Allen' })).toBe(true)
      // Same side, different club: a paste is a snapshot and a traded player's club moves, so he hides.
      expect(v.hides({ name: 'Josh Allen', position: 'QB', team: 'NYJ' })).toBe(true)
    })
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
