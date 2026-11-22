/**
 * Public format landers (/league-types/<slug>) — lib/seo-landing/league-type-pages.ts.
 *
 * What these pin, and why each one matters:
 *   - every lander resolves to a vetted demo entry, so the rules list can never silently vanish;
 *   - the sports shown are ones the create screen accepts — the registry and the catalog seed
 *     disagree for Guillotine, Devy and C2C, and a lander must never promise the wider set;
 *   - canonicals are www, never the apex that 301s;
 *   - titles and descriptions fit what a results page shows.
 */
import { describe, expect, it } from 'vitest'
import {
  LEAGUE_TYPE_PAGES,
  LEAGUE_TYPE_SLUGS,
  getLeagueTypeCanonical,
  getLeagueTypeDemoMeta,
  getLeagueTypePage,
  getLeagueTypeSports,
} from '@/lib/seo-landing/league-type-pages'
import { REQUESTABLE_FORMATS } from '@/lib/create-league-v2/requestedFormat'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'

const page = (slug: string) => {
  const p = getLeagueTypePage(slug)
  if (!p) throw new Error(`no lander ${slug}`)
  return p
}

describe('league type landers', () => {
  it('has one lander per slug, and every slug resolves', () => {
    expect(new Set(LEAGUE_TYPE_SLUGS).size).toBe(LEAGUE_TYPE_PAGES.length)
    for (const slug of LEAGUE_TYPE_SLUGS) expect(getLeagueTypePage(slug)?.slug).toBe(slug)
    expect(getLeagueTypePage('not-a-format')).toBeNull()
  })

  it('every lander has vetted rules from the demo registry and a create link the wizard accepts', () => {
    for (const p of LEAGUE_TYPE_PAGES) {
      const meta = getLeagueTypeDemoMeta(p)
      expect(meta, p.slug).not.toBeNull()
      expect(meta!.rules.length, p.slug).toBeGreaterThan(0)
      expect(meta!.wizardType, p.slug).toBe(p.wizardType)
      expect(REQUESTABLE_FORMATS as readonly string[], p.slug).toContain(p.wizardType)
    }
  })

  it('related links only point at landers that exist, never at itself', () => {
    for (const p of LEAGUE_TYPE_PAGES) {
      for (const r of p.related) {
        expect(LEAGUE_TYPE_SLUGS, `${p.slug} -> ${r}`).toContain(r)
        expect(r).not.toBe(p.slug)
      }
    }
  })

  it('shows only sports BOTH the registry and the catalog allow', () => {
    // The three formats where the two sources disagree, read from the catalog itself.
    const seeded = LEAGUE_CREATE_OPTIONS_CATALOG_V1.allowedSportsByConcept
    for (const [slug, type] of [['guillotine', 'guillotine'], ['devy', 'devy'], ['c2c', 'c2c']] as const) {
      const shown = getLeagueTypeSports(page(slug))
      expect(shown.length, slug).toBeGreaterThan(0)
      for (const s of shown) expect(seeded[type], `${slug} shows ${s}`).toContain(s)
    }
    // Positive control: the registry alone would have offered these, and they must NOT appear.
    expect(getLeagueTypeSports(page('guillotine'))).not.toContain('NCAAF')
    expect(getLeagueTypeSports(page('devy'))).not.toContain('NBA')
    expect(getLeagueTypeSports(page('c2c'))).not.toContain('NBA')
    // IDP is a modifier, not a catalog concept: it follows sport-scope.
    expect(getLeagueTypeSports(page('idp'))).toEqual(['NFL', 'NCAAF'])
  })

  it('canonicals are www, never the apex that redirects', () => {
    expect(getLeagueTypeCanonical()).toBe('https://www.allfantasy.ai/league-types')
    expect(getLeagueTypeCanonical('best-ball')).toBe('https://www.allfantasy.ai/league-types/best-ball')
  })

  it('titles and descriptions fit a results page', () => {
    for (const p of LEAGUE_TYPE_PAGES) {
      expect(p.title.length, `${p.slug} title`).toBeLessThanOrEqual(70)
      expect(p.description.length, `${p.slug} description`).toBeLessThanOrEqual(160)
      expect(p.description.length, `${p.slug} description`).toBeGreaterThanOrEqual(90)
    }
  })
})
