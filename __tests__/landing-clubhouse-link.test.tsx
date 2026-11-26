/**
 * The landing page links the Clubhouse, the public community board, so a visitor can read it
 * before signing up: in the main nav, the phone menu and the footer, in every landing language.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LandingV4 } from '@/components/core-app/screens/LandingV4'
import { LANDING_LANGS } from '@/lib/i18n/landing-copy'

function page(lang: 'en' | 'es') {
  const html = renderToStaticMarkup(<LandingV4 lang={lang} launch={{ startsAt: '2026-10-15T04:00:00.000Z', founding: null }} />)
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('landing: the Clubhouse is one click away', () => {
  it.each(LANDING_LANGS)('%s: main nav, phone menu and footer each link /clubhouse', (lang) => {
    const doc = page(lang)
    const navLink = doc.querySelector('[data-testid="landing-nav-clubhouse"]')
    expect(navLink?.getAttribute('href')).toBe('/clubhouse')
    expect(navLink?.textContent?.trim()).toBe('Clubhouse')
    expect(doc.querySelector('.af-lp-mobile-panel a[href="/clubhouse"]')).not.toBeNull()
    expect(doc.querySelector('.af-lp-footer-links a[href="/clubhouse"]')).not.toBeNull()
  })
})
