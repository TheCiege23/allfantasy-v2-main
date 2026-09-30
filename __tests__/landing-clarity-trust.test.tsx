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
    const order = ['.af-lp-hero', '[data-testid="launch-banner"]', '.af-lp-connects', '#how', '.af-lp-chimmy'].map(
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
    for (const text of [c.hero.reassure, c.steps.items[1].body, c.faq.items[0].a]) {
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

describe('how it works and Chimmy', () => {
  it('"How it works" lands on the steps, and only one element carries the anchor', () => {
    const { doc } = page('en')
    expect(doc.querySelectorAll('#how')).toHaveLength(1)
    expect(doc.querySelector('#how')?.classList.contains('af-lp-steps')).toBe(true)
    expect(doc.querySelectorAll('#how li')).toHaveLength(3)
  })

  it.each(LANDING_LANGS)('%s: the Chimmy allowance is the enforced constant, and the exchange is labelled an example', (lang) => {
    const c = getLandingCopy(lang, PRICES)
    expect(c.chimmy.free).toContain(String(FREE_CHIMMY_QUESTIONS_PER_DAY))
    const { doc } = page(lang)
    expect(doc.querySelector('.af-lp-chimmy-chat')?.textContent).toContain(c.chimmy.exampleLabel)
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
