import { describe, expect, it } from 'vitest'

import { myRosterCandidates, rosterPlayerIds } from '@/lib/core-app/myRoster'

/**
 * `Roster.playerData` parsing. The guard this replaces returned an empty list for every roster
 * in production, which reads downstream as "this league rosters nobody" rather than as a parse
 * failure — and a feature fed by it looks like it is working.
 */

describe('rosterPlayerIds — the shape production actually stores', () => {
  it('reads the object shape, which is 100% of production rows', () => {
    /*
     * THE DEFECT. Measured: 0 of 1,094 roster rows are arrays. Every one is an object with the
     * ids in `players`, as bare strings. An `Array.isArray(playerData)` guard skips all of them.
     */
    const ids = rosterPlayerIds({
      players: ['11624', '12489', '5947'],
      starters: ['11624'],
      taxi: ['13319'],
      reserve: [],
    })
    expect(ids).toEqual(['11624', '12489', '5947', '13319'])
  })

  it('does not double-count a player who is both rostered and starting', () => {
    const ids = rosterPlayerIds({ players: ['1', '2'], starters: ['1'], bench: ['2'] })
    expect(ids).toEqual(['1', '2'])
  })

  it('falls back to lineup_sections when the top-level list is missing', () => {
    // Deduped and read last, so it rescues a roster rather than duplicating a healthy one.
    const ids = rosterPlayerIds({ lineup_sections: { starters: ['7', '8'], bench: ['9'] } })
    expect(ids).toEqual(['7', '8', '9'])
  })

  it('still accepts both legacy array spellings', () => {
    expect(rosterPlayerIds(['1', '2'])).toEqual(['1', '2'])
    expect(rosterPlayerIds([{ playerId: '1' }, { sleeperPlayerId: '2' }, { id: '3' }])).toEqual([
      '1',
      '2',
      '3',
    ])
  })

  it('drops the strings that mean absence rather than admitting them as ids', () => {
    expect(rosterPlayerIds({ players: ['1', null, '', 'null', 'undefined', '2'] })).toEqual(['1', '2'])
  })

  it('returns empty for shapes it genuinely cannot read, without throwing', () => {
    expect(rosterPlayerIds(null)).toEqual([])
    expect(rosterPlayerIds('nonsense')).toEqual([])
    expect(rosterPlayerIds({ nothing: true })).toEqual([])
  })
})

describe('myRosterCandidates', () => {
  it('keeps all three candidates, in order', () => {
    /*
     * With only the first two, 38 of 106 claimed teams joined to a roster. The third exists
     * because `Roster.platformUserId` sometimes holds our own User uuid rather than the
     * platform's id — and it is the candidate that matched in the league used to verify this.
     */
    expect(myRosterCandidates({ platformUserId: 'p', externalId: 'e' }, 'u')).toEqual(['p', 'e', 'u'])
  })

  it('skips the ones that are absent rather than querying for empty strings', () => {
    expect(myRosterCandidates({ platformUserId: null, externalId: '' }, 'u')).toEqual(['u'])
  })
})
