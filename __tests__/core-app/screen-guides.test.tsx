import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const nav = vi.hoisted(() => ({ pathname: '/core/my-team', search: '' }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}))
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>{children}</a>
  ),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import {
  ALL_SCREEN_GUIDE_KEYS,
  HOW_IT_WORKS_GROUPS,
  screenGuide,
  screenGuideHref,
  screenGuideKeyFor,
} from '@/lib/core-app/screenGuides'
import { ScreenGuide } from '@/components/core-app/ScreenGuide'
import { HowItWorks } from '@/components/core-app/HowItWorks'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  lang.language = 'en'
})
beforeEach(() => {
  nav.pathname = '/core/my-team'
  nav.search = ''
})

describe('screenGuideKeyFor', () => {
  it('maps a /core URL segment to its guide', () => {
    expect(screenGuideKeyFor('/core/waivers', true)).toBe('waivers')
    expect(screenGuideKeyFor('/core/leagues', false)).toBe('my-leagues')
  })
  it('keys schedule and moves on the URL, not the home nav item they light', () => {
    expect(screenGuideKeyFor('/core/schedule', true)).toBe('schedule')
    expect(screenGuideKeyFor('/core/moves', true)).toBe('moves')
  })
  it('tells the cross-league Home from one league’s Overview', () => {
    expect(screenGuideKeyFor('/core', false)).toBe('home')
    expect(screenGuideKeyFor('/core', true)).toBe('overview')
  })
  it('draws nothing for a page it does not know, or outside /core', () => {
    expect(screenGuideKeyFor('/core/not-a-screen', true)).toBeNull()
    expect(screenGuideKeyFor('/settings', false)).toBeNull()
    expect(screenGuideKeyFor(null, false)).toBeNull()
  })
})

describe('the guide text', () => {
  it('has a name, one-line what, 1–3 things to do and a start line in both languages', () => {
    for (const key of ALL_SCREEN_GUIDE_KEYS) {
      for (const language of ['en', 'es'] as const) {
        const g = screenGuide(key, language)
        expect(g.name, `${key}/${language}`).toBeTruthy()
        expect(g.what.length, `${key}/${language}`).toBeLessThan(120)
        expect(g.can.length, `${key}/${language}`).toBeGreaterThan(0)
        expect(g.can.length, `${key}/${language}`).toBeLessThanOrEqual(3)
        expect(g.start, `${key}/${language}`).toBeTruthy()
      }
    }
  })
  it('really is Spanish in Spanish', () => {
    for (const key of ALL_SCREEN_GUIDE_KEYS) {
      expect(screenGuide(key, 'es').what, key).not.toBe(screenGuide(key, 'en').what)
    }
  })
  it('never says "waiver" in Spanish, and never says "AI" in either language', () => {
    for (const key of ALL_SCREEN_GUIDE_KEYS) {
      const es = screenGuide(key, 'es')
      expect([es.name, es.what, es.start, ...es.can].join(' ')).not.toMatch(/waiver/i)
      for (const language of ['en', 'es'] as const) {
        const g = screenGuide(key, language)
        expect([g.name, g.what, g.start, ...g.can].join(' '), `${key}/${language}`).not.toMatch(/\bAI\b|\bIA\b/)
      }
    }
  })
  it('lists every How-it-works key once', () => {
    const keys = HOW_IT_WORKS_GROUPS.flatMap((g) => g.keys)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('links league pages with the selected league', () => {
    expect(screenGuideHref('my-team', 'L1')).toBe('/core/my-team?league=L1')
    expect(screenGuideHref('my-leagues', null)).toBe('/core/leagues')
    expect(screenGuideHref('overview', 'L1')).toBe('/core?league=L1')
  })
})

describe('<ScreenGuide />', () => {
  it('opens the first time a page is seen, and folds to one line after "Got it"', () => {
    render(<ScreenGuide />)
    expect(screen.getByRole('button', { name: /What’s this page\?/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Start here:')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.getByRole('button', { name: /What’s this page\?/ })).toHaveAttribute('aria-expanded', 'false')
    expect(window.localStorage.getItem('af-screen-guide-v1:my-team')).toBe('seen')
  })
  it('stays folded on a page already seen — but another page still opens', () => {
    window.localStorage.setItem('af-screen-guide-v1:my-team', 'seen')
    const { unmount } = render(<ScreenGuide />)
    expect(screen.getByRole('button', { name: /What’s this page\?/ })).toHaveAttribute('aria-expanded', 'false')
    unmount()
    nav.pathname = '/core/waivers'
    render(<ScreenGuide />)
    expect(screen.getByRole('button', { name: /What’s this page\?/ })).toHaveAttribute('aria-expanded', 'true')
  })
  it('does not open on Home on top of the welcome tour', () => {
    nav.pathname = '/core'
    render(<ScreenGuide />)
    expect(screen.getByRole('button', { name: /What’s this page\?/ })).toHaveAttribute('aria-expanded', 'false')
  })
  it('renders nothing on a page with no guide', () => {
    nav.pathname = '/core/not-a-screen'
    const { container } = render(<ScreenGuide />)
    expect(container).toBeEmptyDOMElement()
  })
  it('speaks Spanish', () => {
    lang.language = 'es'
    nav.pathname = '/core/waivers'
    render(<ScreenGuide />)
    expect(screen.getByText('Agentes libres que vale la pena sumar en esta liga, y cuánto ofrecer.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Entendido' })).toBeInTheDocument()
  })
})

describe('<HowItWorks />', () => {
  it('says "Pick a league first" for league pages with no league selected, and links them inside one', () => {
    const { unmount } = render(<HowItWorks leagueCount={3} />)
    expect(screen.getAllByText('Pick a league first').length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: 'Import a league' })).toBeNull()
    unmount()
    nav.search = 'league=L1'
    render(<HowItWorks leagueCount={3} />)
    expect(screen.queryByText('Pick a league first')).toBeNull()
    const hrefs = screen.getAllByRole('link', { hidden: true }).map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/core/my-team?league=L1')
  })
  it('offers the import when there are no leagues', () => {
    render(<HowItWorks leagueCount={0} />)
    expect(screen.getByRole('link', { name: 'Import a league', hidden: true })).toHaveAttribute('href', '/import')
  })
})
