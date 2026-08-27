import { describe, expect, it } from 'vitest'

import { parseFantraxLeagueId } from '@/lib/league-import/fantrax/fantraxApi'
import {
  IMPORT_PROVIDER_UI_OPTIONS,
  isImportProviderAvailable,
  supportsImportProviderDiscovery,
} from '@/lib/league-import/provider-ui-config'

/**
 * The Fantrax tile said "soon" long after Fantrax stopped being unreachable: it
 * has a live read API (`fxea`), so a league is importable from the id in its URL
 * and the CSV export is no longer the only way in.
 *
 * ⚠ THE FLAG IS THE LEAST OF IT. Flipping `available` alone would have produced
 * a selectable tile that could not finish — the old copy asked for a "snapshot
 * id" that only exists after a CSV upload. These pin the pieces that make the
 * flip honest.
 */

describe('what the user pastes', () => {
  /**
   * ⚠ NOTHING ON FANTRAX EVER SHOWS THE BARE ID. It exists only as a path
   * segment, so "copy your league ID" in practice means copying the address bar.
   */
  it('takes the league URL people actually copy', () => {
    expect(parseFantraxLeagueId('https://www.fantrax.com/fantasy/league/v2kzedypmm8jp61b/home')).toBe(
      'v2kzedypmm8jp61b',
    )
  })

  it('takes a bare id, and any page of the league', () => {
    expect(parseFantraxLeagueId('v2kzedypmm8jp61b')).toBe('v2kzedypmm8jp61b')
    expect(parseFantraxLeagueId('fantrax.com/fantasy/league/v2kzedypmm8jp61b/standings')).toBe(
      'v2kzedypmm8jp61b',
    )
  })

  /**
   * ⚠ CASE IS PRESERVED. Fantrax ids are case-sensitive and a lowercased id
   * returns an HTML error page rather than JSON — verified live.
   */
  it('does not normalise case', () => {
    expect(parseFantraxLeagueId('V2KzedYpmm8jp61b')).toBe('V2KzedYpmm8jp61b')
  })

  it('rejects what is not an id rather than sending it to Fantrax', () => {
    for (const junk of ['', '   ', 'not a league', 'short', 'my fantrax league']) {
      expect(parseFantraxLeagueId(junk)).toBeNull()
    }
  })
})

describe('the tile is live, and the flow behind it exists', () => {
  it('fantrax is selectable', () => {
    expect(isImportProviderAvailable('fantrax')).toBe(true)
  })

  /**
   * ⚠ DISCOVERY LISTS TEAMS, NOT LEAGUES, and that is the only reason the tile
   * can be live without asking for a credential. Listing someone's leagues needs
   * their Fantrax Secret ID; a league id is public, so the flow inverts — you
   * name the league and we ask which team is yours.
   */
  it('supports discovery, which is what gives the user a pickable list', () => {
    expect(supportsImportProviderDiscovery('fantrax')).toBe(true)
  })

  it('claims both sports, which the measured sport detection backs up', () => {
    const fantrax = IMPORT_PROVIDER_UI_OPTIONS.find((o) => o.provider === 'fantrax')
    expect(fantrax?.supportedSports).toEqual(['NFL', 'NCAAF'])
  })
})
