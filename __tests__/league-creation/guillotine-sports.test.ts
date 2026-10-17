/**
 * Guillotine is offered only where a season can run.
 *
 * The wizard, server create gate, and rules catalog must agree on the enabled sports.
 * MLB runs the daily-sport finalizer with its complete RI slate; NCAAF guillotine remains gated.
 */
import { describe, expect, it } from 'vitest'

import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import { getAllowedSportsFromCatalog } from '@/lib/league-creation/options-catalog'
import { getAllowedSportsForType, isSportAllowedForType } from '@/lib/create-league-v2/rules-engine'
import { getConceptById } from '@/lib/league-rules/conceptCatalog'
import { canRunSeasonForSport } from '@/lib/sport-scope'

describe('guillotine sports', () => {
  it('the server create gate enables MLB guillotine and keeps NCAAF gated', () => {
    const allowed = getAllowedSportsFromCatalog(LEAGUE_CREATE_OPTIONS_CATALOG_V1, 'guillotine')
    expect([...allowed].sort()).toEqual(['MLB', 'NBA', 'NFL', 'NHL'])
    expect(allowed).not.toContain('NCAAF')
    expect(allowed).toContain('MLB')
  })

  it('the wizard offers MLB guillotine and keeps NCAAF gated', () => {
    expect(isSportAllowedForType('NCAAF', 'guillotine')).toBe(false)
    expect(isSportAllowedForType('MLB', 'guillotine')).toBe(true)
    expect(isSportAllowedForType('NFL', 'guillotine')).toBe(true)
    expect([...getAllowedSportsForType('guillotine')].sort()).toEqual(['MLB', 'NBA', 'NFL', 'NHL'])
  })

  it('🛑 every sport guillotine is offered in can run a season — so it can never regress silently', () => {
    const allowed = getAllowedSportsFromCatalog(LEAGUE_CREATE_OPTIONS_CATALOG_V1, 'guillotine')
    expect(allowed.filter((sport) => !canRunSeasonForSport(sport))).toEqual([])
  })

  it('the rules catalog lists the same sports as the create gate', () => {
    const catalog = getConceptById('guillotine')!
    expect([...catalog.supportedSports].sort()).toEqual(
      [...getAllowedSportsFromCatalog(LEAGUE_CREATE_OPTIONS_CATALOG_V1, 'guillotine')].sort(),
    )
  })

  it('redraft is untouched in NCAAF and MLB (only guillotine changed)', () => {
    expect(isSportAllowedForType('NCAAF', 'redraft')).toBe(true)
    expect(isSportAllowedForType('MLB', 'redraft')).toBe(true)
  })
})
