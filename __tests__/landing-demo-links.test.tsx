/**
 * The landing hero is where a signed-out visitor can try AllFantasy before signing up:
 * "Try the demo" (the live, anonymized league) and a link to an example of every league
 * type. Both must render in every landing language and point at public demo routes.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LandingV4 } from '@/components/core-app/screens/LandingV4'
import { getLandingCopy, LANDING_LANGS } from '@/lib/i18n/landing-copy'

function hero(lang: 'en' | 'es') {
  const html = renderToStaticMarkup(<LandingV4 lang={lang} launch={{ startsAt: '2026-10-15T04:00:00.000Z', founding: null }} />)
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('landing hero: try before you sign up', () => {
  it.each(LANDING_LANGS)('%s: "Try the demo" opens the live demo league', (lang) => {
    const a = hero(lang).querySelector('[data-testid="landing-try-demo"]')
    expect(a?.getAttribute('href')).toBe('/demo')
    expect(a?.textContent?.trim()).toBe(getLandingCopy(lang, { min: '$9.99', max: '$19.99' }).hero.ctaDemo)
  })

  it.each(LANDING_LANGS)('%s: a link opens the example of every league type', (lang) => {
    const a = hero(lang).querySelector('[data-testid="landing-hero-league-types-link"] a')
    expect(a?.getAttribute('href')).toBe('/demo/formats')
    const text = getLandingCopy(lang, { min: '$9.99', max: '$19.99' }).hero.leagueTypesLink
    expect(text.length).toBeGreaterThan(10)
    expect(a?.textContent?.trim()).toBe(text)
  })
})
