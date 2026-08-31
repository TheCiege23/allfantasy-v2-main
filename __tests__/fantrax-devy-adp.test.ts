/**
 * Fantrax college ADP → DevyPlayer matching rules.
 *
 * 🛑 `DevyPlayer.devyAdp` IS READ IN A DOZEN PLACES AND WRITTEN BY NOTHING.
 * Measured on production: 337 of 1,721 rows carry a value and the rest are null,
 * and lib/trade-intel/devyOutlook.ts states that no market prices college
 * players. `getAdp?sport=NCAAF` is a market — 997 priced players, verified live
 * 2026-08-31 — so this is the writer.
 *
 * ⚠ THE TESTS THAT MATTER ARE THE REFUSALS. Attaching a market price to the
 * wrong player is worse than leaving the column null, so the rules below are
 * about when NOT to match.
 */

import { describe, expect, it } from 'vitest'

import {
  attachSchools,
  normalizePlayerName,
  normalizeSchool,
} from '@/lib/devy/ingestFantraxDevyAdp'

describe('normalizePlayerName', () => {
  /**
   * ⚠ FANTRAX WRITES "LAST, FIRST"; THE DEVY TABLE WRITES "FIRST LAST".
   * Both the ADP feed and the roster payload use the comma form. Comparing them
   * unflipped matches almost nothing, which reads as "Fantrax has no ADP for our
   * players" rather than as a format mismatch — a silent zero, not an error.
   */
  it('flips "Last, First" into "first last"', () => {
    expect(normalizePlayerName('Abney, Christian')).toBe('christian abney')
    expect(normalizePlayerName('Dendy, Austyn')).toBe('austyn dendy')
  })

  it('leaves an already-ordered name alone', () => {
    expect(normalizePlayerName('Noah Fox-Flores')).toBe('noah foxflores')
  })

  it('normalises punctuation that differs between sources', () => {
    /* O'Brien / OBrien and Fox-Flores / Fox Flores are the same player. */
    expect(normalizePlayerName("O'Brien, Sean")).toBe(normalizePlayerName('Sean OBrien'))
  })

  it('is empty for empty input rather than throwing', () => {
    expect(normalizePlayerName('')).toBe('')
    expect(normalizePlayerName('   ')).toBe('')
  })

  /* A suffix is part of the name in one source and absent in the other; both
     normalise to something stable rather than to a crash. */
  it('handles a three-part comma name without inventing words', () => {
    expect(normalizePlayerName('Smith Jr., John')).toBe('john smith jr')
  })
})

describe('normalizeSchool', () => {
  it('strips case and punctuation so abbreviations compare', () => {
    expect(normalizeSchool('Bowling Green')).toBe('bowlinggreen')
    expect(normalizeSchool('BGSU')).toBe('bgsu')
    expect(normalizeSchool('Texas St.')).toBe('texasst')
  })
})

describe('attachSchools', () => {
  const adp = [
    { fantraxId: 'a', name: 'Abney, Christian', position: 'TE', adp: 338.65 },
    { fantraxId: 'missing', name: 'Ghost, Player', position: 'WR', adp: 400 },
  ]

  it('takes the school from the CFB player map by Fantrax id', () => {
    const out = attachSchools(adp, {
      a: { fantraxId: 'a', name: 'Abney, Christian', team: 'Cincinnati', position: 'TE' },
    })
    expect(out[0]).toMatchObject({ fantraxId: 'a', school: 'Cincinnati' })
  })

  /**
   * ⚠ A MISSING ID IS EXPECTED, NOT AN ERROR. Roughly one id in twenty is absent
   * from the CFB map — graduated or inactive — and the ingestion counts those as
   * unmatched rather than falling back to a name-only match, which is the
   * ambiguity the school exists to remove.
   */
  it('leaves school null when the id is not in the map, rather than guessing', () => {
    const out = attachSchools(adp, {})
    expect(out.every((e) => e.school === null)).toBe(true)
  })

  it('preserves the ADP value untouched', () => {
    const out = attachSchools(adp, {})
    expect(out[0]!.adp).toBe(338.65)
  })
})
