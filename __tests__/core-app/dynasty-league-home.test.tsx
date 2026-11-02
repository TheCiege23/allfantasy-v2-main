/**
 * The Dynasty Era deck on /core's league Home: the builder (lib/core-app/dynastyLeagueHome.ts) only
 * passes stored facts through and drops a block whose read is empty, and the component draws what it
 * is given — in English and in Spanish.
 */
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildDynastyHomeDeck, starterIdsOf, taxiIdsOf } from '@/lib/core-app/dynastyLeagueHome'
import type { DynastyOutlook } from '@/lib/core-app/dynastyOutlook'

const lang = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.language, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))

import { DynastyHomeDeck } from '@/components/core-app/screens/DynastyHomeDeck'
import { dynastyHomeFixture } from '@/app/e2e/dynasty-core/home/fixture'

const outlook = (over: Partial<DynastyOutlook> = {}): DynastyOutlook => ({
  picks: {
    available: true,
    coverage: 'complete',
    bySeason: [
      { season: 2027, picks: [{ season: 2027, round: 1, label: '1st', fromTeamName: null }, { season: 2027, round: 1, label: '1st', fromTeamName: 'Rival' }] },
      { season: 2028, picks: [{ season: 2028, round: 3, label: '3rd', fromTeamName: null }] },
    ],
  },
  ages: { available: true, medianStarterAge: 26, known: 8, total: 9, aging: [{ sleeperId: '1', name: 'A', position: 'RB', age: 28, threshold: 27 }], youngCore: 5 },
  ...over,
})
const IMPORT = { season: 2026, sport: 'NFL', platform: 'sleeper', settings: {}, createdAt: null }

describe('buildDynastyHomeDeck', () => {
  it('counts Year N from the first season on file when the commissioner set no startup season', () => {
    const deck = buildDynastyHomeDeck({ league: IMPORT, firstSeasonOnFile: 2022, rafters: null, outlook: null, taxi: null })
    expect(deck.clock).toEqual({ season: 2026, year: 5 })
  })

  it('prefers startup_season, and shows the season alone rather than guess when neither is known', () => {
    expect(buildDynastyHomeDeck({ league: { ...IMPORT, settings: { startup_season: 2024 } }, firstSeasonOnFile: 2020, rafters: null, outlook: null, taxi: null }).clock).toEqual({ season: 2026, year: 3 })
    expect(buildDynastyHomeDeck({ league: IMPORT, firstSeasonOnFile: null, rafters: null, outlook: null, taxi: null }).clock).toEqual({ season: 2026, year: null })
  })

  it('passes picks and ages through and counts first-rounders', () => {
    const deck = buildDynastyHomeDeck({ league: IMPORT, firstSeasonOnFile: 2022, rafters: null, outlook: outlook(), taxi: { count: 2, slots: 3 } })
    expect(deck.picks).toMatchObject({ total: 3, firstRounders: 2, partial: false })
    expect(deck.picks?.seasons[0].picks[1]).toEqual({ round: 1, label: '1st', via: 'Rival' })
    expect(deck.ages).toEqual({ medianStarterAge: 26, known: 8, total: 9, youngCore: 5, aging: 1 })
    expect(deck.taxi).toEqual({ count: 2, slots: 3 })
  })

  it('drops every block whose read is empty, unavailable or partial-free nothing', () => {
    const deck = buildDynastyHomeDeck({
      league: IMPORT,
      firstSeasonOnFile: null,
      rafters: null,
      outlook: { picks: { available: false, reason: 'x' }, ages: { available: false, reason: 'y' } },
      taxi: { count: 0, slots: 0 },
    })
    expect(deck.picks).toBeNull()
    expect(deck.ages).toBeNull()
    expect(deck.taxi).toBeNull()
  })

  it('marks partial pick coverage', () => {
    const o = outlook()
    const deck = buildDynastyHomeDeck({ league: IMPORT, firstSeasonOnFile: null, rafters: null, outlook: { ...o, picks: { ...(o.picks as Extract<DynastyOutlook['picks'], { available: true }>), coverage: 'partial' } }, taxi: null })
    expect(deck.picks?.partial).toBe(true)
  })
})

describe('roster blob helpers', () => {
  it('reads taxi from the top level, else lineup_sections, and drops empty-slot markers', () => {
    expect(taxiIdsOf({ taxi: ['1', '2', '2'] })).toEqual(['1', '2'])
    expect(taxiIdsOf({ taxi: [], lineup_sections: { taxi: [{ id: '9' }, '0'] } })).toEqual(['9'])
    expect(taxiIdsOf(null)).toEqual([])
    expect(taxiIdsOf([{ id: 'x' }])).toEqual([])
  })
  it('reads starters without Sleeper empty slots', () => {
    expect(starterIdsOf({ starters: ['4', '0', '', 'null', '7'] })).toEqual(['4', '7'])
  })
})

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ')

describe('DynastyHomeDeck', () => {
  it('draws the era, the rafters, capital, ages and taxi from the harness fixture', () => {
    lang.language = 'en'
    const data = dynastyHomeFixture({ identity: true, sparse: false })
    const { container } = render(<DynastyHomeDeck deck={data.dynasty!} leagueId="L 1" />)
    expect(text(container.querySelector('[data-testid=dynasty-home-clock]'))).toBe('Year 5 · 2026 season')
    const rafters = container.querySelector('[data-testid=dynasty-home-rafters]')
    expect(rafters?.querySelectorAll('[data-mine=true].af-lh-dy-pennant')).toHaveLength(1)
    expect(rafters?.querySelector('[data-open=true]')?.getAttribute('aria-label')).toBe('2026: title still open')
    expect(text(rafters)).toContain('1 title is yours')
    const capital = container.querySelector('[data-testid=dynasty-home-capital]')
    expect(text(capital)).toContain('8 picks held')
    expect(text(capital)).toContain('3 first-rounders')
    expect(capital?.querySelector('a')?.getAttribute('href')).toBe('/core/trades?league=L%201')
    expect(text(container.querySelector('[data-testid=dynasty-home-ages]'))).toContain('25.5 median starter age')
    expect(container.querySelectorAll('[data-testid=dynasty-home-taxi] li[data-filled=true]')).toHaveLength(3)
  })

  it('with nothing on file it still draws the era band, and only that', () => {
    lang.language = 'en'
    const data = dynastyHomeFixture({ identity: true, sparse: true })
    const { container } = render(<DynastyHomeDeck deck={{ ...data.dynasty!, ages: null, taxi: null }} leagueId="L" />)
    expect(text(container.querySelector('[data-testid=dynasty-home-clock]'))).toBe('2026 season')
    expect(container.querySelector('[data-testid=dynasty-home-rafters]')).toBeNull()
    expect(container.querySelector('.af-lh-dy-grid')).toBeNull()
  })

  it('speaks Spanish', () => {
    lang.language = 'es'
    const data = dynastyHomeFixture({ identity: true, sparse: false })
    const { container } = render(<DynastyHomeDeck deck={data.dynasty!} leagueId="L" />)
    expect(container.querySelector('[data-testid=dynasty-home-deck]')?.getAttribute('aria-label')).toBe('Dinastía')
    expect(text(container.querySelector('[data-testid=dynasty-home-clock]'))).toBe('Año 5 · Temporada 2026')
    expect(text(container)).toContain('Capital de draft')
    expect(text(container)).not.toMatch(/Draft capital|Roster age|Taxi squad/)
  })
})
