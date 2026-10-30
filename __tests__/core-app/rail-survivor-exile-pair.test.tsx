import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The /core rail draws each Exile Island under its own Survivor league, joined by a ↕ (reported
 * 2026-10-30: two NBA Survivor leagues, two islands listed apart from them, and no way to tell which
 * island went with which league).
 */

const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import AfCoreShell from '@/components/core-app/AfCoreShell'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}))))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const rail = [
  { id: 'exile-a', name: 'Exile Island: NBA Survivor', platform: 'manual', mark: 'E', sport: 'NBA', exileOf: 'survivor-a' },
  { id: 'exile-b', name: "Exile Island: TheCiege's Survivor", platform: 'manual', mark: 'E', sport: 'NBA', exileOf: 'survivor-b' },
  { id: 'redraft', name: 'The Ciege NBA Redraft', platform: 'manual', mark: 'R', sport: 'NBA' },
  { id: 'survivor-a', name: 'NBA Survivor', platform: 'manual', mark: 'S', sport: 'NBA' },
  { id: 'survivor-b', name: "TheCiege's Survivor", platform: 'manual', mark: 'S', sport: 'NBA' },
]

const shell = (leagues: unknown[]) => (
  <AfCoreShell active="home" leagues={leagues as never} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0}>
    <div>screen</div>
  </AfCoreShell>
)

/** A rail row's league id: native leagues link to /league/<id>, the rest to /core?league=<id>. */
function leagueIdOf(el: Element): string {
  const url = new URL(el.getAttribute('href')!, 'https://x')
  return url.searchParams.get('league') ?? url.pathname.split('/').pop()!
}

/** The rail's league rows top to bottom by id, with the connector as "↕". */
function railOrder(): string[] {
  const scroll = document.querySelector('.af-rail-scroll')!
  return Array.from(scroll.querySelectorAll('.af-rail-exile-link, a.af-rail-tile[data-platform]')).map((el) =>
    el.classList.contains('af-rail-exile-link') ? '↕' : leagueIdOf(el),
  )
}

describe('Survivor and Exile Island on the rail', () => {
  it('draws each island under its own Survivor league, joined by ↕', () => {
    render(shell(rail))
    expect(railOrder()).toEqual(['redraft', 'survivor-a', '↕', 'exile-a', 'survivor-b', '↕', 'exile-b'])
  })

  it('names a paired island "Exile Island", and keeps its full name for screen readers', () => {
    render(shell(rail))
    const island = Array.from(document.querySelectorAll('a.af-rail-tile[data-exile="true"]')).find((el) => leagueIdOf(el) === 'exile-a')!
    expect(island.textContent).toContain('Exile Island')
    expect(island.textContent).not.toContain('NBA Survivor')
    expect(island.getAttribute('aria-label')).toContain('Exile Island: NBA Survivor')
  })

  it('draws no ↕ when a favorite puts the Survivor league and its island in different sections', () => {
    render(
      <AfCoreShell
        active="home"
        leagues={rail as never}
        scope={{ value: null, label: 'All leagues', favoriteIds: ['survivor-a'], leagues: rail } as never}
        syncAge={{ label: 'just now', stale: false }}
        syncEligibleCount={0}
      >
        <div>screen</div>
      </AfCoreShell>,
    )
    expect(railOrder().filter((x) => x === '↕')).toHaveLength(1) // survivor-b's pair only
    const islandA = Array.from(document.querySelectorAll('a.af-rail-tile[data-platform]')).find((el) => leagueIdOf(el) === 'exile-a')!
    expect(islandA.getAttribute('data-exile')).toBeNull()
  })

  it('an island row says your tokens and the way back, not "Matchup not available yet"', () => {
    const withStatus = rail.map((l) =>
      l.id === 'exile-a' ? { ...l, exileStatus: { kind: 'island', tokens: 3, tokensToReturn: 4, returnWeek: 10 } }
      : l.id === 'exile-b' ? { ...l, exileStatus: { kind: 'watching', onIsland: 2 } } : l)
    render(shell(withStatus))
    const lines = Array.from(document.querySelectorAll('[data-testid="rail-exile-status"]')).map((el) => el.textContent)
    expect(lines).toEqual(['3 of 4 tokens · return after week 10', '2 on the island'])
    const islandA = Array.from(document.querySelectorAll('a.af-rail-tile[data-exile="true"]')).find((el) => leagueIdOf(el) === 'exile-a')!
    expect(islandA.textContent).not.toContain('Matchup not available yet')
  })

  it('CONTROL: without the link the island is an ordinary row, where it was', () => {
    render(shell(rail.map(({ exileOf: _exileOf, ...league }) => league)))
    expect(railOrder()).toEqual(['exile-a', 'exile-b', 'redraft', 'survivor-a', 'survivor-b'])
    expect(document.querySelector('[data-exile="true"]')).toBeNull()
  })
})
