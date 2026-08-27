import { describe, expect, it } from 'vitest'

import { isIdpLeagueVariant } from '@/lib/core-app/idpLeagueVariant'

/**
 * The comparison this replaces never matched a league in production.
 */
describe('isIdpLeagueVariant', () => {
  it('matches the casing production actually stores', () => {
    /*
     * THE DEFECT. `LeagueShell` gated its IDP tab on
     * `leagueVariant === 'idp' || leagueVariant === 'dynasty_idp'`, and every IDP league in the
     * database is stored as `DYNASTY_IDP`. All ten were flagged correctly and none ever saw the
     * tab.
     */
    expect(isIdpLeagueVariant('DYNASTY_IDP')).toBe(true)
    expect(isIdpLeagueVariant('dynasty_idp')).toBe(true)
    expect(isIdpLeagueVariant('IDP')).toBe(true)
    expect(isIdpLeagueVariant('idp')).toBe(true)
  })

  it('does not match the variants that are not IDP leagues', () => {
    // These are the other values present in production; none of them roster defenders.
    for (const v of ['dynasty', 'redraft', 'tournament_mode', 'survivor', 'zombie', 'big_brother']) {
      expect(isIdpLeagueVariant(v)).toBe(false)
    }
  })

  it('treats an absent variant as not-IDP rather than throwing', () => {
    // 74 leagues carry a null variant; a page that showed them a Defense Hub would render an
    // empty board with a confident title.
    expect(isIdpLeagueVariant(null)).toBe(false)
    expect(isIdpLeagueVariant(undefined)).toBe(false)
    expect(isIdpLeagueVariant('')).toBe(false)
  })
})
