import { describe, expect, it } from 'vitest'

import { buildSleeperDobMap } from '@/lib/espn/sleeperDobMap'

/*
 * This map exists because the ESPN linker was corroborating against
 * `Player.birthDate`, which production populates on 12% of NFL rows, while the
 * 15,777 birthdays this app actually holds live on `SportsPlayer.dob`. ESPN
 * evidence is a name and a birthday and nothing else, so a candidate with no
 * birthday can only ever be refused on name alone — which is what happened to
 * 471 of 1,163 attempted rows.
 *
 * Simulated over the real unlinked set, feeding these birthdays in takes links
 * from 222 to 420 without touching MIN_LINK_CONFIDENCE.
 */
describe('buildSleeperDobMap', () => {
  it('composes player id to birthday through the sleeper id', () => {
    const map = buildSleeperDobMap(
      [
        { playerId: 'p1', providerPlayerId: '4034' },
        { playerId: 'p2', providerPlayerId: '6794' },
      ],
      [
        { sleeperId: '4034', dob: '1999-03-11' },
        { sleeperId: '6794', dob: '2000-10-02' },
      ],
    )
    expect(map.get('p1')).toBe('1999-03-11')
    expect(map.get('p2')).toBe('2000-10-02')
    expect(map.size).toBe(2)
  })

  /*
   * ⚠ THE LOAD-BEARING ONE. Two Sleeper identities on one player point at two
   * different athletes. Taking whichever came back first hands the matcher a
   * birthday belonging to somebody else — and unlike a missing birthday, which
   * produces a refusal, a wrong one can produce a confident wrong link into the
   * table a live resolver reads.
   */
  it('drops a player carrying two sleeper identities rather than picking one', () => {
    const map = buildSleeperDobMap(
      [
        { playerId: 'p1', providerPlayerId: '4034' },
        { playerId: 'p1', providerPlayerId: '9999' },
        { playerId: 'p2', providerPlayerId: '6794' },
      ],
      [
        { sleeperId: '4034', dob: '1999-03-11' },
        { sleeperId: '9999', dob: '1988-01-01' },
        { sleeperId: '6794', dob: '2000-10-02' },
      ],
    )
    expect(map.has('p1')).toBe(false)
    expect(map.get('p2')).toBe('2000-10-02')
  })

  it('drops it even when the ambiguity appears after a good row', () => {
    const map = buildSleeperDobMap(
      [
        { playerId: 'p1', providerPlayerId: '4034' },
        { playerId: 'p1', providerPlayerId: '4034' },
      ],
      [{ sleeperId: '4034', dob: '1999-03-11' }],
    )
    /* Two rows are two rows, even pointing at the same sleeper id: the pair is
       a data state we do not understand, and guessing past it is the habit this
       guard exists to prevent. */
    expect(map.has('p1')).toBe(false)
  })

  it('omits a player whose sleeper id carries no birthday', () => {
    const map = buildSleeperDobMap(
      [{ playerId: 'p1', providerPlayerId: '4034' }],
      [{ sleeperId: '4034', dob: null }],
    )
    expect(map.size).toBe(0)
  })

  it('ignores identity rows with no player and blank birthdays', () => {
    const map = buildSleeperDobMap(
      [
        { playerId: null, providerPlayerId: '4034' },
        { playerId: 'p2', providerPlayerId: '' },
        { playerId: 'p3', providerPlayerId: '6794' },
      ],
      [
        { sleeperId: '4034', dob: '1999-03-11' },
        { sleeperId: '6794', dob: '   ' },
      ],
    )
    expect(map.size).toBe(0)
  })

  it('keeps the first birthday when a sleeper id has duplicate rows', () => {
    const map = buildSleeperDobMap(
      [{ playerId: 'p1', providerPlayerId: '4034' }],
      [
        { sleeperId: '4034', dob: '1999-03-11' },
        { sleeperId: '4034', dob: '1977-01-01' },
      ],
    )
    expect(map.get('p1')).toBe('1999-03-11')
  })

  it('trims a padded birthday rather than passing whitespace to the matcher', () => {
    const map = buildSleeperDobMap(
      [{ playerId: 'p1', providerPlayerId: '4034' }],
      [{ sleeperId: '4034', dob: '  1999-03-11 ' }],
    )
    expect(map.get('p1')).toBe('1999-03-11')
  })
})
