import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The /core home's "My leagues" card draws each Exile Island under its own Survivor league, joined
 * by a ↕ — the same pairing as the rail (reported 2026-10-30: two NBA Survivor leagues, two islands,
 * and no way to tell which island went with which league).
 */

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/geo/useGeoRestriction', () => ({ useGeoRestriction: () => ({ loading: true, isPaidBlocked: false }) }))
vi.mock('@/components/values/ValuesPageLink', () => ({ ValuesPageLink: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))
vi.mock('@/components/core-app/highlights/LeagueClipSpotlight', () => ({ default: () => null }))

import { Dash3ALeagues } from '@/components/core-app/screens/Dashboard3A'
import { leagueCardGroups } from '@/lib/core-app/survivorExileRail'

afterEach(cleanup)

const league = (id: string, name: string, exileOf?: string) => ({ id, name, platform: 'manual' as const, sport: 'NBA', exileOf })
const survivorA = league('survivor-a', 'NBA Survivor')
const survivorB = league('survivor-b', "TheCiege's Survivor")
const exileA = league('exile-a', 'Exile Island: NBA Survivor', 'survivor-a')
const exileB = league('exile-b', "Exile Island: TheCiege's Survivor", 'survivor-b')
const redraft = league('redraft', 'The Ciege NBA Redraft')

function leagueIdOf(el: Element): string {
  const url = new URL(el.getAttribute('href')!, 'https://x')
  return url.searchParams.get('league') ?? url.pathname.split('/').pop()!
}

/** The card's rows top to bottom by id, with the connector as "↕". */
function cardOrder(): string[] {
  return Array.from(document.querySelectorAll('.af3a-leagues .af3a-exile-link, .af3a-leagues a.af3a-league')).map((el) =>
    el.classList.contains('af3a-exile-link') ? '↕' : leagueIdOf(el),
  )
}

describe('Survivor and Exile Island on the home leagues card', () => {
  it('draws each island under its own Survivor league, joined by ↕', () => {
    render(<Dash3ALeagues leagues={[exileA, exileB, redraft, survivorA, survivorB]} totalLeagues={5} />)
    expect(cardOrder()).toEqual(['redraft', 'survivor-a', '↕', 'exile-a', 'survivor-b', '↕', 'exile-b'])
    expect(document.querySelectorAll('[data-testid="league-exile-pair"]')).toHaveLength(2)
  })

  it('names a paired island "Exile Island", and keeps its full name for screen readers', () => {
    render(<Dash3ALeagues leagues={[survivorA, exileA]} totalLeagues={2} />)
    const island = document.querySelector('a.af3a-league[data-exile="true"]')!
    expect(island.textContent).toContain('Exile Island')
    expect(island.textContent).not.toContain('NBA Survivor')
    expect(island.getAttribute('aria-label')).toBe('Exile Island: NBA Survivor')
  })

  it('brings the island along from every league when the capped queue holds only the Survivor league', () => {
    render(<Dash3ALeagues leagues={[survivorA, redraft]} allLeagues={[survivorA, redraft, exileA]} totalLeagues={3} />)
    expect(cardOrder()).toEqual(['survivor-a', '↕', 'exile-a', 'redraft'])
  })

  it('an island does not take one of the five places', () => {
    const others = [1, 2, 3, 4].map((n) => league(`l${n}`, `League ${n}`))
    const groups = leagueCardGroups([survivorA, exileA, ...others, league('l5', 'League 5')], [], 5)
    expect(groups.map((g) => g.league.id)).toEqual(['survivor-a', 'l1', 'l2', 'l3', 'l4'])
    expect(groups[0].islands.map((i) => i.id)).toEqual(['exile-a'])
  })

  it('CONTROL: without the link the island is an ordinary row, where it was', () => {
    const plain = [exileA, exileB, redraft, survivorA, survivorB].map(({ exileOf: _e, ...l }) => l)
    render(<Dash3ALeagues leagues={plain} totalLeagues={5} />)
    expect(cardOrder()).toEqual(['exile-a', 'exile-b', 'redraft', 'survivor-a', 'survivor-b'])
    expect(document.querySelector('[data-exile="true"]')).toBeNull()
  })
})

describe('the home leagues card count', () => {
  it('counts an island on screen as shown, so five of five is not "4 of 5"', () => {
    const others = [1, 2, 3].map((n) => league(`l${n}`, `League ${n}`))
    render(<Dash3ALeagues leagues={[...others, survivorA, exileA]} totalLeagues={5} />)
    expect(document.querySelector('.af3a-cardhead')!.textContent).toContain('5 total')
    expect(document.querySelector('a.af3a-cardlink')).toBeNull()
  })
})
