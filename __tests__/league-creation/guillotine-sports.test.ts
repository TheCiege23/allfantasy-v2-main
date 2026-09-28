/**
 * Guillotine is offered only where a season can run.
 *
 * A guillotine league IS its weekly chop. NCAAF and MLB cannot finalize a week (they are outside
 * `SEASON_CAPABLE_SPORTS`), so a guillotine league created there would draft and then never
 * eliminate anyone. Removed 2026-09-28 by product decision. One list is both the wizard's tiles and
 * the server's create gate (`createLeagueHandler` -> `getAllowedSportsFromCatalog`); these pin it.
 */
import { describe, expect, it } from 'vitest'

import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import { getAllowedSportsFromCatalog } from '@/lib/league-creation/options-catalog'
import { getAllowedSportsForType, isSportAllowedForType } from '@/lib/create-league-v2/rules-engine'
import { getConceptById } from '@/lib/league-rules/conceptCatalog'
import { canRunSeasonForSport } from '@/lib/sport-scope'

describe('guillotine sports', () => {
  it('the server create gate refuses NCAAF and MLB guillotine', () => {
    const allowed = getAllowedSportsFromCatalog(LEAGUE_CREATE_OPTIONS_CATALOG_V1, 'guillotine')
    expect([...allowed].sort()).toEqual(['NBA', 'NFL', 'NHL'])
    expect(allowed).not.toContain('NCAAF')
    expect(allowed).not.toContain('MLB')
  })

  it('the wizard offers no guillotine tile in NCAAF or MLB', () => {
    expect(isSportAllowedForType('NCAAF', 'guillotine')).toBe(false)
    expect(isSportAllowedForType('MLB', 'guillotine')).toBe(false)
    expect(isSportAllowedForType('NFL', 'guillotine')).toBe(true)
    expect([...getAllowedSportsForType('guillotine')].sort()).toEqual(['NBA', 'NFL', 'NHL'])
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
