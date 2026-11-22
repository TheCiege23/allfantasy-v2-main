/**
 * /sports/<slug> copy and the two facts it computes rather than states.
 *
 *   - Import platforms come from the importer config. NFL has several; most sports have one. A
 *     page written once for "fantasy sports" would promise imports that the importer refuses.
 *   - League types come from the same rule as the format landers.
 *   - Copy fits a results page, and every sport says how it scores.
 */
import { describe, expect, it } from 'vitest'
import { SPORT_CONFIG, SPORT_SLUGS, getImportPlatformsForSport } from '@/lib/seo-landing/config'
import { getLeagueTypesForSport } from '@/lib/seo-landing/league-type-pages'
import { getImportProviderSupportedSports, isImportProviderAvailable } from '@/lib/league-import/provider-ui-config'

describe('sport landing copy', () => {
  it('every sport has a scoring line, a noun for its button, and copy that fits a results page', () => {
    for (const slug of SPORT_SLUGS) {
      const c = SPORT_CONFIG[slug]
      expect(c.scoring.trim(), slug).not.toBe('')
      expect(c.noun.trim(), slug).not.toBe('')
      expect(c.title.length, `${slug} title`).toBeLessThanOrEqual(70)
      expect(c.description.length, `${slug} description`).toBeLessThanOrEqual(160)
    }
  })

  it('tool links are unique per sport (they are React keys) and none is a sign-in-only page', () => {
    for (const slug of SPORT_SLUGS) {
      const hrefs = SPORT_CONFIG[slug].toolHrefs.map((t) => t.href)
      expect(new Set(hrefs).size, slug).toBe(hrefs.length)
      // /mock-draft and /core/* serve sign-in to a logged-out reader; the public landers exist.
      for (const h of hrefs) {
        expect(h, slug).not.toBe('/mock-draft')
        expect(h.startsWith('/core/'), `${slug} ${h}`).toBe(false)
      }
    }
  })

  it('import platforms follow the importer config, sport by sport', () => {
    // Positive control first: football has more than one platform, so a filter that ignored the
    // sport and returned every live platform would still pass the per-sport loop below.
    expect(getImportPlatformsForSport('NFL').length).toBeGreaterThan(getImportPlatformsForSport('NBA').length)
    expect(getImportPlatformsForSport('NBA')).not.toContain('Sleeper')
    for (const slug of SPORT_SLUGS) {
      const sport = SPORT_CONFIG[slug].leagueSport
      expect(getImportPlatformsForSport(sport).length, sport).toBeGreaterThan(0)
    }
    // Every platform named for MLB is live and lists MLB itself.
    for (const name of getImportPlatformsForSport('MLB')) {
      const provider = name === 'MFL' ? 'mfl' : (name.toLowerCase() as 'espn' | 'fantrax')
      expect(isImportProviderAvailable(provider), name).toBe(true)
      expect(getImportProviderSupportedSports(provider), name).toContain('MLB')
    }
  })

  it('league types per sport respect format limits', () => {
    const slugs = (s: string) => getLeagueTypesForSport(s).map((p) => p.slug)
    expect(slugs('NFL')).toContain('devy')
    expect(slugs('NBA')).not.toContain('devy')
    expect(slugs('SOCCER')).not.toContain('survivor')
    expect(slugs('NCAAF')).toContain('idp')
    expect(slugs('NBA')).not.toContain('idp')
  })
})
