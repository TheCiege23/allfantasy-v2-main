/**
 * A signed-out visitor can try AllFantasy before signing up: "Try the demo" in the hero (the
 * live, anonymized league), and the demo section's "League types" tab, which links to an example
 * of every league type (moved out of the hero on 2026-11-13). Both must render in every landing
 * language and point at public demo routes.
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

  it.each(LANDING_LANGS)('%s: the demo section links to the example of every league type', (lang) => {
    const a = hero(lang).querySelector('#demo [data-testid="landing-league-types-link"] a')
    expect(a?.getAttribute('href')).toBe('/demo/formats')
    const text = getLandingCopy(lang, { min: '$9.99', max: '$19.99' }).demo.typesCta
    expect(text.length).toBeGreaterThan(10)
    expect(a?.textContent?.trim()).toBe(text)
  })
})
