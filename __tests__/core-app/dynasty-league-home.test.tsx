/**
 * The Dynasty Era deck on /core's league Home: the builder (lib/core-app/dynastyLeagueHome.ts) only
 * passes stored facts through and drops a block whose read is empty, and the component draws what it
 * is given — in English and in Spanish.
 */
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildDynastyHomeDeck, starterIdsOf, taxiIdsOf, type DynastyOffseasonInput } from '@/lib/core-app/dynastyLeagueHome'
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

describe('DynastyHomeDeck in season (pinned)', () => {
  it('renders byte-for-byte what it rendered before the offseason state existed', async () => {
    lang.language = 'en'
    const data = dynastyHomeFixture({ identity: true, sparse: false })
    const { container } = render(<DynastyHomeDeck deck={data.dynasty!} leagueId="L 1" />)
    await expect(container.innerHTML).toMatchFileSnapshot('./__snapshots__/dynasty-home-in-season.html')
  })
})

const OFF_NOW = new Date('2027-02-20T17:00:00Z')
const offInput = (over: Partial<DynastyOffseasonInput> = {}): DynastyOffseasonInput => ({
  stage: 'complete',
  now: OFF_NOW,
  draftAt: null,
  draftLive: false,
  draftScheduled: false,
  keeperDeadlineAt: null,
  rolledOverAt: null,
  nextSeasonStartAt: null,
  ...over,
})
const RAFTERS = {
  pennants: [
    { season: 2025, label: 'Bench Mob', mine: false },
    { season: 2026, label: 'Taco Tuesday', mine: false },
  ],
  openSeason: null,
  myTitles: 0,
}

describe('buildDynastyHomeDeck between seasons', () => {
  it('in season it builds exactly what it built before: no offseason key, nothing reordered', () => {
    const base = buildDynastyHomeDeck({ league: IMPORT, firstSeasonOnFile: 2022, rafters: RAFTERS, outlook: outlook(), taxi: { count: 1, slots: 2 } })
    for (const stage of ['in_season', 'regular_season', null]) {
      const deck = buildDynastyHomeDeck({ league: IMPORT, firstSeasonOnFile: 2022, rafters: RAFTERS, outlook: outlook(), taxi: { count: 1, slots: 2 }, offseason: offInput({ stage }) })
      expect(deck).toEqual(base)
      expect('offseason' in deck).toBe(false)
    }
  })

  it('a startup league in its first draft is not an offseason', () => {
    const deck = buildDynastyHomeDeck({ league: IMPORT, firstSeasonOnFile: 2026, rafters: null, outlook: null, taxi: null, offseason: offInput({ stage: 'pre_draft' }) })
    expect(deck.offseason).toBeUndefined()
    expect(buildDynastyHomeDeck({ league: IMPORT, firstSeasonOnFile: null, rafters: null, outlook: null, taxi: null, offseason: offInput({ stage: 'drafting' }) }).offseason).toBeUndefined()
  })

  it('after the final: Year N complete, the champion from the rafters, stored milestones only', () => {
    const deck = buildDynastyHomeDeck({
      league: IMPORT,
      firstSeasonOnFile: 2022,
      rafters: { ...RAFTERS, pennants: RAFTERS.pennants.slice(0, 1), openSeason: 2026 },
      outlook: outlook(),
      taxi: null,
      offseason: offInput({ draftAt: new Date('2027-05-09T00:00:00Z'), rolledOverAt: new Date('2027-02-02T15:00:00Z') }),
    })
    const off = deck.offseason!
    expect(off).toMatchObject({ phase: 'season_complete', completedSeason: 2026, nextSeason: 2027, nextDraftSeason: 2027, champion: null })
    // The 2026 title is not "open" once the season is over, even when its champion is not on file.
    expect(deck.rafters?.openSeason).toBeNull()
    expect(off.milestones).toEqual([
      { key: 'rollover', season: 2027, at: '2027-02-02T15:00:00.000Z', daysAway: null, state: 'done' },
      { key: 'rookie_draft', season: 2027, at: '2027-05-09T00:00:00.000Z', daysAway: 78, state: 'upcoming' },
      { key: 'kickoff', season: 2027, at: null, daysAway: null, state: 'upcoming' },
    ])
  })

  it('names the champion just crowned and leads the capital card with the next draft', () => {
    const o = outlook()
    const picks = o.picks as Extract<DynastyOutlook['picks'], { available: true }>
    const deck = buildDynastyHomeDeck({
      league: IMPORT,
      firstSeasonOnFile: 2022,
      rafters: RAFTERS,
      outlook: { ...o, picks: { ...picks, bySeason: [...picks.bySeason].reverse() } },
      taxi: null,
      offseason: offInput(),
    })
    expect(deck.offseason?.champion).toEqual({ season: 2026, label: 'Taco Tuesday', mine: false })
    expect(deck.picks?.seasons.map((s) => s.season)).toEqual([2027, 2028])
  })

  it('never guesses a date: a start already past is an earlier draft, and no picks and no row means no draft milestone', () => {
    const past = new Date('2026-08-20T23:00:00Z')
    const withPicks = buildDynastyHomeDeck({ league: IMPORT, firstSeasonOnFile: 2022, rafters: null, outlook: outlook(), taxi: null, offseason: offInput({ draftAt: past }) })
    expect(withPicks.offseason?.milestones.find((m) => m.key === 'rookie_draft')).toEqual({ key: 'rookie_draft', season: 2027, at: null, daysAway: null, state: 'upcoming' })
    const noPicks = buildDynastyHomeDeck({ league: IMPORT, firstSeasonOnFile: 2022, rafters: null, outlook: null, taxi: null, offseason: offInput({ draftAt: past }) })
    expect(noPicks.offseason?.milestones.map((m) => m.key)).toEqual(['kickoff'])
    const scheduled = buildDynastyHomeDeck({ league: IMPORT, firstSeasonOnFile: 2022, rafters: null, outlook: null, taxi: null, offseason: offInput({ draftScheduled: true }) })
    expect(scheduled.offseason?.milestones.map((m) => m.key)).toEqual(['rookie_draft', 'kickoff'])
  })

  it('in the next season before kickoff: Year N+1 begins, reigning champion, a live draft, dated keeper and kickoff in order', () => {
    const league = { ...IMPORT, season: 2027 }
    const deck = buildDynastyHomeDeck({
      league,
      firstSeasonOnFile: 2022,
      rafters: RAFTERS,
      outlook: null,
      taxi: null,
      offseason: offInput({ stage: 'drafting', keeperDeadlineAt: new Date('2027-02-25T17:00:00Z'), draftAt: new Date('2027-02-22T17:00:00Z'), nextSeasonStartAt: new Date('2027-09-10T00:20:00Z') }),
    })
    expect(deck.clock).toEqual({ season: 2027, year: 6 })
    expect(deck.offseason).toMatchObject({ phase: 'next_season', completedSeason: 2026, nextSeason: 2027, champion: { season: 2026, label: 'Taco Tuesday' } })
    expect(deck.offseason?.milestones.map((m) => [m.key, m.state, m.daysAway])).toEqual([
      ['keeper_deadline', 'upcoming', 5],
      ['rookie_draft', 'live', null],
      ['kickoff', 'upcoming', 202],
    ])
  })

  it('puts a dated draft before a later keeper deadline', () => {
    const deck = buildDynastyHomeDeck({
      league: IMPORT, firstSeasonOnFile: 2022, rafters: null, outlook: null, taxi: null,
      offseason: offInput({ keeperDeadlineAt: new Date('2027-06-01T00:00:00Z'), draftAt: new Date('2027-05-01T00:00:00Z') }),
    })
    expect(deck.offseason?.milestones.map((m) => m.key)).toEqual(['rookie_draft', 'keeper_deadline', 'kickoff'])
  })
})

describe('DynastyHomeDeck between seasons', () => {
  it('draws Year N complete, the champion, the Offseason timeline and the next draft first', () => {
    lang.language = 'en'
    const data = dynastyHomeFixture({ identity: true, sparse: false, offseason: true })
    const { container } = render(<DynastyHomeDeck deck={data.dynasty!} leagueId="L 1" />)
    expect(container.querySelector('[data-testid=dynasty-home-deck]')?.getAttribute('data-phase')).toBe('offseason')
    expect(text(container.querySelector('.af-lh-dy-eyebrow'))).toBe('Dynasty Offseason')
    expect(text(container.querySelector('[data-testid=dynasty-home-clock]'))).toBe('Year 5 complete 2026 season')
    expect(text(container.querySelector('[data-testid=dynasty-home-champion]'))).toBe('Taco Tuesday won the 2026 title')
    expect(container.querySelector('.af-lh-dy-tagline')).toBeNull()
    expect(container.querySelector('[data-open=true]')).toBeNull()
    const steps = [...container.querySelectorAll('[data-testid=dynasty-home-milestone]')].map(text)
    expect(steps).toEqual(['2027 season set upTue, Feb 2, 2027Done', '2027 rookie draftSat, May 8, 2027In 78 days', '2027 season startsDate not on file'])
    expect(container.querySelector('[data-key=kickoff]')?.getAttribute('data-undated')).toBe('true')
    expect(container.querySelector('[data-testid=dynasty-home-offseason] a')?.getAttribute('href')).toBe('/core/draft-hq?league=L%201')
    const capital = container.querySelector('[data-testid=dynasty-home-capital]')
    expect(text(capital?.querySelector('[data-testid=dynasty-home-next-draft]') ?? null)).toBe('4 picks in the 2027 draft8 held in all')
    expect(capital?.querySelectorAll('li[data-next=true]')).toHaveLength(1)
    expect(capital?.querySelector('li[data-next=true]')?.textContent).toContain('2027Next draft')
    // The age card is kept as it is.
    expect(text(container.querySelector('[data-testid=dynasty-home-ages]'))).toContain('25.5 median starter age')
  })

  it('speaks Spanish between seasons', () => {
    lang.language = 'es'
    const data = dynastyHomeFixture({ identity: true, sparse: false, offseason: true })
    const { container } = render(<DynastyHomeDeck deck={data.dynasty!} leagueId="L" />)
    expect(text(container.querySelector('[data-testid=dynasty-home-clock]'))).toBe('Año 5 completado Temporada 2026')
    expect(text(container.querySelector('[data-testid=dynasty-home-champion]'))).toBe('Taco Tuesday ganó el título de 2026')
    const steps = [...container.querySelectorAll('[data-testid=dynasty-home-milestone]')].map(text)
    expect(steps[0]).toMatch(/^Temporada 2027 preparada.*Hecho$/)
    expect(steps[1]).toMatch(/^Draft de novatos 2027.*En 78 días$/)
    expect(steps[2]).toBe('Arranca la temporada 2027Fecha no registrada')
    expect(text(container.querySelector('[data-testid=dynasty-home-next-draft]'))).toBe('4 selecciones en el draft de 20278 en total')
    expect(text(container)).not.toMatch(/Offseason|Date not on file|Next draft|won the/)
  })

  it('in season draws no offseason element at all', () => {
    lang.language = 'en'
    const data = dynastyHomeFixture({ identity: true, sparse: false })
    const { container } = render(<DynastyHomeDeck deck={data.dynasty!} leagueId="L" />)
    expect(container.querySelector('[data-phase], [data-testid=dynasty-home-offseason], [data-testid=dynasty-home-champion], [data-next]')).toBeNull()
  })
})
