// @vitest-environment jsdom
/**
 * /commissioners — the Commissioner OS page — and the links that lead to it.
 *
 * What a commissioner must see BEFORE a price: the headline, the five live features, a roadmap that
 * is visibly not live, and platform chips read from the import config (so Yahoo is "coming soon"
 * for exactly as long as the import API refuses it). And every "For commissioners" link on `/` must
 * land here, not on /pricing.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { getImportPlatforms } from '@/lib/league-import/provider-ui-config'
import { COMMISSIONER_FEATURES, COMMISSIONERS_ROADMAP } from '@/components/core-app/screens/commissionersCopy'

async function renderCommissioners(signedIn = false) {
  const { CommissionersV4 } = await import('@/components/core-app/screens/CommissionersV4')
  const html = renderToStaticMarkup(<CommissionersV4 signedIn={signedIn} />)
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('/commissioners', () => {
  it('leads with the commissioner headline, one h1, and headings in order', async () => {
    const doc = await renderCommissioners()
    const h1s = doc.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(h1s[0].textContent).toBe('Built by a commissioner,for commissioners.')
    // No heading level is skipped: every h3 sits after some h2.
    const levels = [...doc.querySelectorAll('h1, h2, h3, h4')].map((h) => Number(h.tagName[1]))
    levels.forEach((lvl, i) => {
      if (i > 0) expect(lvl - levels[i - 1]).toBeLessThanOrEqual(1)
    })
  })

  it('primary CTA goes to signup-then-import when signed out, straight to /import when signed in', async () => {
    const out = await renderCommissioners(false)
    const outHref = out.querySelector('[data-testid="commissioners-hero-primary"]')?.getAttribute('href') ?? ''
    expect(outHref).toMatch(/^\/signup\?next=%2Fimport/)
    const signedIn = await renderCommissioners(true)
    expect(signedIn.querySelector('[data-testid="commissioners-hero-primary"]')?.getAttribute('href')).toBe('/import')
    expect(out.querySelector('[data-testid="commissioners-hero-pricing"]')?.getAttribute('href')).toBe('/pricing')
  })

  it('renders all five features, each with a screenshot slot that has alt text', async () => {
    const doc = await renderCommissioners()
    for (const f of COMMISSIONER_FEATURES) {
      const section = doc.getElementById(f.id)
      expect(section, f.id).not.toBeNull()
      const img = section!.querySelector('img')
      if (img) expect(img.getAttribute('alt')).toBe(f.imageAlt)
      else expect(section!.querySelector(`[data-screenshot-placeholder="${f.image}"]`)?.textContent).toContain(f.imageAlt)
    }
  })

  it('badges every roadmap item as coming soon', async () => {
    const doc = await renderCommissioners()
    const cards = doc.querySelectorAll('.af-cx-roadmap-card')
    expect(cards).toHaveLength(COMMISSIONERS_ROADMAP.items.length)
    cards.forEach((c) => expect(c.querySelector('.af-cx-soon-badge')?.textContent).toMatch(/coming soon/i))
  })

  it('platform chips follow the import config — Yahoo marked coming soon, never named as importable', async () => {
    const doc = await renderCommissioners()
    for (const p of getImportPlatforms()) {
      const chip = doc.querySelector(`.af-lp-connect[data-provider="${p.provider}"]`)
      expect(chip, p.provider).not.toBeNull()
      expect(chip!.getAttribute('data-state')).toBe(p.status === 'live' ? 'live' : 'soon')
    }
    expect(doc.querySelector('.af-lp-connect[data-provider="yahoo"]')?.textContent).toMatch(/coming soon/i)
    const hub = doc.getElementById('league-hub')?.textContent ?? ''
    expect(hub).not.toMatch(/Yahoo/)
    expect(hub).toMatch(/Sleeper/)
  })

  it('never frames itself as AI-powered or as anything to do with betting', async () => {
    const text = (await renderCommissioners()).body.textContent ?? ''
    expect(text).not.toMatch(/AI-powered|powered by AI/i)
    expect(text).not.toMatch(/\bbet(ting)?\b|wager|odds/i)
  })
})

describe('/ — every "For commissioners" link goes to /commissioners', () => {
  it('nav, mobile menu and footer link to /commissioners, the hero carries the line, and none goes to /pricing', async () => {
    const { LandingV4 } = await import('@/components/core-app/screens/LandingV4')
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(<LandingV4 lang="en" launch={null} />), 'text/html')
    const commishLinks = [...doc.querySelectorAll('a')].filter((a) => /for commissioners/i.test(a.textContent ?? ''))
    expect(commishLinks.length).toBeGreaterThanOrEqual(3)
    commishLinks.forEach((a) => expect(a.getAttribute('href')).toBe('/commissioners'))
    const line = doc.querySelector('[data-testid="landing-commish-line"]')
    expect(line?.textContent).toMatch(/Built by a commissioner, for commissioners\./)
    expect(line?.querySelector('a')?.getAttribute('href')).toBe('/commissioners')
  })
})
