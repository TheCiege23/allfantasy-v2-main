/**
 * Locks the canonical AllFantasyAdpSnapshot.playerKey shape.
 *
 * Bug history this guards against:
 *  - Writer used naive lowercase, resolver used canonicalName-style stripping.
 *    100% of AI ADP lookups silently missed in the live draft pool until the
 *    helper was unified in lib/adp/playerKey.ts.
 *
 * If any of these tests change, the recompute script MUST also be re-run so
 * stored keys match the new shape — or orphan rows accumulate and lookups
 * silently miss again.
 */
import { describe, expect, it } from 'vitest'
import {
  buildAllFantasyAdpPlayerKey,
  buildAllFantasyAdpPlayerKeyPositional,
  normalizeAdpPlayerName,
  normalizeAdpPosition,
} from '@/lib/adp/playerKey'
import { buildPlayerKey } from '@/lib/adp/computeAllFantasyAdp'

describe('normalizeAdpPlayerName', () => {
  it('lowercases and trims', () => {
    expect(normalizeAdpPlayerName('  Mike Evans  ')).toBe('mike evans')
  })

  it('strips dots from initials so T.J. and TJ collapse', () => {
    expect(normalizeAdpPlayerName('T.J. Hockenson')).toBe(normalizeAdpPlayerName('TJ Hockenson'))
    expect(normalizeAdpPlayerName('A.J. Brown')).toBe('aj brown')
  })

  it('strips apostrophes (straight + curly) so Ja\'Marr and JaMarr collapse', () => {
    expect(normalizeAdpPlayerName("Ja'Marr Chase")).toBe(normalizeAdpPlayerName('JaMarr Chase'))
    expect(normalizeAdpPlayerName('Ja’Marr Chase')).toBe('jamarr chase')
    expect(normalizeAdpPlayerName("De'Von Achane")).toBe('devon achane')
  })

  it('handles trailing-dot suffixes so "Jr." and "Jr" collapse', () => {
    expect(normalizeAdpPlayerName('Brian Thomas Jr.')).toBe(normalizeAdpPlayerName('Brian Thomas Jr'))
    expect(normalizeAdpPlayerName('Marvin Harrison Jr.')).toBe('marvin harrison jr')
  })

  it('handles comma-separated suffix forms', () => {
    expect(normalizeAdpPlayerName('Darius Pinnix, Jr.')).toBe('darius pinnix jr')
  })

  it('collapses whitespace', () => {
    expect(normalizeAdpPlayerName('  A  J   Brown ')).toBe('a j brown')
  })

  it('returns empty string for null/undefined/blank', () => {
    expect(normalizeAdpPlayerName(null)).toBe('')
    expect(normalizeAdpPlayerName(undefined)).toBe('')
    expect(normalizeAdpPlayerName('   ')).toBe('')
  })
})

describe('normalizeAdpPosition', () => {
  it('lowercases short codes', () => {
    expect(normalizeAdpPosition('WR')).toBe('wr')
    expect(normalizeAdpPosition('RB')).toBe('rb')
    expect(normalizeAdpPosition('QB')).toBe('qb')
  })

  it('maps thesportsdb full forms back to short codes', () => {
    expect(normalizeAdpPosition('Wide Receiver')).toBe('wr')
    expect(normalizeAdpPosition('Running Back')).toBe('rb')
    expect(normalizeAdpPosition('Tight End')).toBe('te')
    expect(normalizeAdpPosition('Quarterback')).toBe('qb')
    expect(normalizeAdpPosition('Kicker')).toBe('k')
  })

  it('handles cross-sport positions', () => {
    expect(normalizeAdpPosition('Point Guard')).toBe('pg')
    expect(normalizeAdpPosition('Goalkeeper')).toBe('gk')
    expect(normalizeAdpPosition('Midfielder')).toBe('mid')
    expect(normalizeAdpPosition('Defenseman')).toBe('defenseman') // unmapped → falls through lowercased
  })

  it('returns empty string for null/undefined', () => {
    expect(normalizeAdpPosition(null)).toBe('')
    expect(normalizeAdpPosition(undefined)).toBe('')
  })
})

describe('buildAllFantasyAdpPlayerKey', () => {
  it('produces the same key for source-drift name variants', () => {
    const a = buildAllFantasyAdpPlayerKey({ name: 'T.J. Hockenson', position: 'TE' })
    const b = buildAllFantasyAdpPlayerKey({ name: 'TJ Hockenson', position: 'TE' })
    expect(a).toBe(b)
    expect(a).toBe('tj hockenson|te')
  })

  it('produces the same key for source-drift position variants', () => {
    const a = buildAllFantasyAdpPlayerKey({ name: 'Mike Evans', position: 'WR' })
    const b = buildAllFantasyAdpPlayerKey({ name: 'Mike Evans', position: 'Wide Receiver' })
    expect(a).toBe(b)
    expect(a).toBe('mike evans|wr')
  })

  it('produces the same key for apostrophe variants', () => {
    const a = buildAllFantasyAdpPlayerKey({ name: "Ja'Marr Chase", position: 'WR' })
    const b = buildAllFantasyAdpPlayerKey({ name: 'JaMarr Chase', position: 'WR' })
    expect(a).toBe(b)
    expect(a).toBe('jamarr chase|wr')
  })

  it('produces the same key for suffix variants', () => {
    const a = buildAllFantasyAdpPlayerKey({ name: 'Brian Thomas Jr.', position: 'WR' })
    const b = buildAllFantasyAdpPlayerKey({ name: 'Brian Thomas Jr', position: 'WR' })
    expect(a).toBe(b)
  })

  it('does not collide distinct players sharing a normalized first part', () => {
    const a = buildAllFantasyAdpPlayerKey({ name: 'Josh Allen', position: 'QB' })
    const b = buildAllFantasyAdpPlayerKey({ name: 'Josh Allen', position: 'LB' })
    expect(a).not.toBe(b)
  })
})

describe('writer / resolver / audit MUST share the same key helper', () => {
  // This is the regression guard. If `buildPlayerKey` from computeAllFantasyAdp
  // diverges from the shared helper, the resolver's AI ADP overlay silently misses.
  it('lib/adp/computeAllFantasyAdp.buildPlayerKey delegates to the shared helper', () => {
    const cases: Array<[string, string]> = [
      ['T.J. Hockenson', 'TE'],
      ['TJ Hockenson', 'TE'],
      ["Ja'Marr Chase", 'WR'],
      ['Brian Thomas Jr.', 'Wide Receiver'],
      ['Mike Evans', 'WR'],
      ['Drake London', 'wr'],
      ['Amon-Ra St. Brown', 'WR'],
    ]
    for (const [name, position] of cases) {
      expect(buildPlayerKey(name, position)).toBe(
        buildAllFantasyAdpPlayerKey({ name, position }),
      )
      expect(buildAllFantasyAdpPlayerKeyPositional(name, position)).toBe(
        buildAllFantasyAdpPlayerKey({ name, position }),
      )
    }
  })
})
