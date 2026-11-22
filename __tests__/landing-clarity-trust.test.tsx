// @vitest-environment jsdom
/**
 * The landing page's clarity + trust pass (2026-09-29). A stranger should know what AllFantasy is
 * within five seconds, and every promise on the page should be one the product keeps.
 *
 * The facts here are read from the config that decides them — never re-typed — so these tests
 * assert the page FOLLOWS the config rather than pinning today's values. Where a fact is a
 * snapshot of the config (five live platforms today), the test derives its expectation from the
 * same config, so the day a platform flips, the page and the test move together.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LandingV4 } from '@/components/core-app/screens/LandingV4'
import { getLandingCopy, LANDING_LANGS } from '@/lib/i18n/landing-copy'
import {
  getLandingConnectPlatforms,
  getLandingImportSports,
  getLandingLivePlatformNames,
} from '@/components/core-app/screens/landingConnectPlatforms'
import { FREE_CHIMMY_QUESTIONS_PER_DAY } from '@/lib/tokens/freeChimmyQuestions'

const PRICES = { min: '$9.99', max: '$19.99' }
const LIVE = getLandingLivePlatformNames()
const SOON = getLandingConnectPlatforms()
  .filter((p) => p.state === 'soon')
  .map((p) => p.name)

function page(lang: 'en' | 'es') {
  const html = renderToStaticMarkup(
    <LandingV4 lang={lang} launch={{ startsAt: '2026-10-15T04:00:00.000Z', founding: null }} />,
  )
  return { html, doc: new DOMParser().parseFromString(html, 'text/html') }
}

describe('what it is, in the first screen', () => {
  it.each(LANDING_LANGS)('%s: the line above the headline identifies fantasy', (lang) => {
    expect(getLandingCopy(lang, PRICES).hero.eyebrow).toMatch(/fantasy/i)
  })

  it('the countdown comes after the hero, not before it', () => {
    const { doc } = page('en')
    // 2026-11-13 order: the commissioner band right under the platform strip, then what you get,
    // game day and the demo. (The "Every league + Chimmy" band folded into "What you get".)
    const order = [
      '.af-lp-hero',
      '[data-testid="launch-banner"]',
      '.af-lp-connects',
      '.af-lp-commish',
      '#how',
      '#game-day',
      '#demo',
    ].map(
      (sel) => {
        const el = doc.querySelector(sel)
        expect(el, sel).not.toBeNull()
        return [...doc.querySelectorAll('*')].indexOf(el as Element)
      },
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
})

describe('platforms: every sentence reads the live list', () => {
  // Positive control: the config really has several live platforms and at least one "soon".
  it('control: the config has live and soon platforms to tell apart', () => {
    expect(LIVE.length).toBeGreaterThan(2)
    expect(SOON.length).toBeGreaterThan(0)
  })

  it.each(LANDING_LANGS)('%s: detailed platform claims follow the live list, while first-screen copy stays concise', (lang) => {
    const c = getLandingCopy(lang, PRICES)
    for (const text of [c.meta.description, c.faq.items[0].a]) {
      for (const name of LIVE) expect(text, name).toContain(name)
      for (const name of SOON) expect(text, name).not.toContain(name)
    }
    for (const text of [c.hero.sub, c.meta.ogDescription]) {
      expect(text).toMatch(/creat|crea/i)
      for (const name of SOON) expect(text, name).not.toContain(name)
    }
  })

  it.each(LANDING_LANGS)('%s: the username-only promise is made for Sleeper alone', (lang) => {
    const c = getLandingCopy(lang, PRICES)
    // ESPN private leagues and MFL need more than a username, so the claim must name Sleeper.
    // The hero's reassurance line and the three steps were folded away on 2026-11-13; the FAQ
    // answer is where the promise lives now.
    for (const text of [c.faq.items[0].a]) {
      expect(text).toMatch(/Sleeper/)
      expect(text).toMatch(/username|usuario/i)
    }
  })
})

describe('sports: import and create are labelled separately', () => {
  it('imports list only sports a LIVE platform supports', () => {
    const sports = getLandingImportSports([
      { available: true, supportedSports: ['NFL'] },
      { available: false, supportedSports: ['NFL', 'NCAAF'] },
    ])
    expect(sports).toEqual(['NFL'])
  })

  it('the rendered strip puts the import list and the create list under their own labels', () => {
    const { doc } = page('en')
    const lines = [...doc.querySelectorAll('.af-lp-sports > span')].map((s) => s.textContent ?? '')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^Imports /)
    expect(lines[0]).toContain(getLandingImportSports().join(' · '))
    expect(lines[1]).toMatch(/^Create a league /)
    expect(lines[1]).toContain('NBA')
  })
})

describe('what you get, game day and Chimmy', () => {
  it('"What you get" carries the #how anchor, alone, with its four items', () => {
    const { doc } = page('en')
    expect(doc.querySelectorAll('#how')).toHaveLength(1)
    expect(doc.querySelector('#how')?.classList.contains('af-lp-get')).toBe(true)
    expect(doc.querySelectorAll('#how li')).toHaveLength(4)
  })

  it.each(LANDING_LANGS)('%s: the Chimmy allowance is the enforced constant, and the game-day card is labelled an example', (lang) => {
    const c = getLandingCopy(lang, PRICES)
    const { doc } = page(lang)
    expect(doc.querySelector('#how')?.textContent).toContain(String(FREE_CHIMMY_QUESTIONS_PER_DAY))
    expect(doc.querySelector('.af-lp-gd-card')?.textContent).toContain(c.gameDay.exampleLabel)
  })

  it('the game-day button opens the player finder, through sign-up when signed out', () => {
    const out = page('en').doc.querySelector('[data-testid="landing-game-day-cta"]')
    expect(out?.getAttribute('href')).toBe('/signup?next=%2Fcore%2Fplayers')
    const html = renderToStaticMarkup(<LandingV4 lang="en" signedIn launch={null} />)
    const inDoc = new DOMParser().parseFromString(html, 'text/html')
    expect(inDoc.querySelector('[data-testid="landing-game-day-cta"]')?.getAttribute('href')).toBe('/core/players')
  })

  it('every demo tab panel is in the server HTML, so crawlers and no-JS readers get all three', () => {
    const { doc } = page('en')
    for (const id of ['leagues', 'trade', 'types']) {
      expect(doc.querySelector(`[data-testid="landing-demo-panel-${id}"]`), id).not.toBeNull()
    }
    expect(doc.querySelector('[data-testid="landing-demo-panel-trade"] [data-testid="landing-trade-market"]')).not.toBeNull()
  })
})

describe('header: Sign in and Sign up are a pair', () => {
  it.each(LANDING_LANGS)('%s signed out: both show in the desktop bar AND the phone bar, not only in a menu', (lang) => {
    const c = getLandingCopy(lang, PRICES)
    const { doc } = page(lang)
    // The phone bar uses the short forms: the long Spanish pair pushed the menu off a 390px screen.
    for (const [bar, inLabel, upLabel] of [
      ['.af-lp-nav-right', c.nav.signIn, c.nav.getStarted],
      ['.af-lp-mobile-actions', c.nav.signInShort, c.nav.getStartedShort],
    ]) {
      const signIn = doc.querySelector(`${bar} a[href="/login"]`)
      const signUp = doc.querySelector(`${bar} a[href="/signup"]`)
      expect(signIn?.textContent, `${bar} sign in`).toBe(inLabel)
      expect(signUp?.textContent, `${bar} sign up`).toBe(upLabel)
      // The sign-in link must not be hidden inside the collapsed menu.
      expect(signIn?.closest('details'), bar).toBeNull()
    }
    expect(doc.querySelector('[data-testid="landing-hero-sign-in"]')?.getAttribute('href')).toBe('/login')
  })

  it('signed in: no Sign in anywhere, and the primary button goes to the dashboard', () => {
    const html = renderToStaticMarkup(<LandingV4 lang="en" signedIn launch={null} />)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('a[href="/login"]')).toBeNull()
    expect(doc.querySelector('[data-testid="landing-nav-primary"]')?.getAttribute('href')).toBe('/core')
  })

  it('the language switch is in both bars, as real links', () => {
    const { doc } = page('es')
    for (const bar of ['.af-lp-nav-right', '.af-lp-mobile-actions']) {
      const opts = [...doc.querySelectorAll(`${bar} > .af-lp-lang a`)].map((a) => [a.textContent, a.getAttribute('href')])
      expect(opts, bar).toEqual([
        ['EN', '/'],
        ['ES', '/?lang=es'],
      ])
    }
  })
})

describe('Brown Pig network', () => {
  it('is a footer line, not a section, and keeps every product link', () => {
    const { doc } = page('en')
    expect(doc.querySelector('section.af-lp-network')).toBeNull()
    const links = [...doc.querySelectorAll('.af-lp-footer-network a')].map((a) => a.textContent)
    expect(links).toEqual(getLandingCopy('en', PRICES).network.cards.map((n) => n.name))
    expect(doc.querySelector('.af-lp-footer-network')?.closest('footer')).not.toBeNull()
  })
})
