import React from 'react'
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * League Overview in plain words (2026-11-14), for every league and format. Found on the owner's dynasty
 * league: this week's opponent was in the headline, in a Matchup card and on the scoreboard; "moves are
 * made on Sleeper" four times; Ask Chimmy twice; the points twice in Standings (a bar chart, then the PF
 * column) on a six-row table that left out the viewer at 12th; "4", "4 of 4 slots used" and "Taxi squad
 * is full."; "Week 12" over "Trade deadline after Week 12 · 2 weeks left"; and two count tiles over a
 * names line on the commissioner card.
 */

const lang = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({
    language: lang.language,
    t: (k: string) => k,
    tInterpolate: (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k),
  }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams('league=lg-1'),
}))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ canConfirm: false }), { status: 200 }))))
})
afterEach(() => { vi.unstubAllGlobals(); lang.language = 'en' })

import { LeagueHome } from '@/components/core-app/screens/LeagueHome'
import { DynastyHomeDeck } from '@/components/core-app/screens/DynastyHomeDeck'
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'
import type { DynastyHomeDeck as DynastyDeck } from '@/lib/core-app/dynastyLeagueHome'
import type { RailMatchup } from '@/lib/core-app/railMatchups'
import { overviewWeekLine, standingsRowsToShow } from '@/lib/core-app/leagueOverviewGuide'
import { leagueOverviewGuideMessages } from '@/lib/core-app/messages/leagueOverviewGuide'
import { leagueHomeMessages } from '@/lib/core-app/messages/leagueHome'
import { dynastyHomeDeckMessages } from '@/lib/core-app/messages/dynastyHomeDeck'

const off = { available: false as const, reason: 'not in this fixture' }

function page(over: Partial<Record<string, unknown>> = {}, youAt = 11): LeagueHomeData {
  return {
    pairing: null,
    league: { id: 'lg-1', name: 'Kings', platform: 'sleeper', format: 'Dynasty', sport: 'NFL', season: 2026, currentWeek: 10 },
    importCoverage: { capabilities: {}, missing: [], partial: [], sentence: '', hasGaps: false },
    yourTeam: { available: true, data: { record: '2-7', rank: youAt + 1 } },
    stage: null,
    preSeason: false,
    rosteredPlayerCount: 150,
    weekPicker: null,
    standings: {
      available: true,
      data: Array.from({ length: 14 }, (_, i) => ({
        teamId: `t${i}`, teamName: i === youAt ? 'NewYorkJets!' : `Team ${i + 1}`, rank: i + 1, wins: 9 - Math.min(i, 9), losses: Math.min(i, 9), ties: 0,
        pointsFor: 2600 - i * 50, isYou: i === youAt, faabRemaining: null,
      })),
    },
    timeline: off,
    matchup: {
      available: true,
      data: { week: 10, season: 2026, you: { name: 'NewYorkJets!', points: 0 }, opponent: { name: 'Dolphins (B2B Champs)', points: 13 },
        winProbability: { pWin: 0.09, detail: '', confidence: 'medium' } },
    },
    draftHq: off,
    commissioner: off,
    buzz: off,
    scoreboard: off,
    powerBoard: off,
    rivalry: off,
    syncAge: { label: '48s ago', stale: false },
    ...over,
  } as unknown as LeagueHomeData
}

describe('the rules', () => {
  it('says this week once: the game in a head-to-head league, the cut in an elimination league', () => {
    expect(overviewWeekLine({ kind: 'h2h', rank: 12, teams: 14, record: '2-7', opponent: 'Dolphins', winPct: 9 }))
      .toEqual({ kind: 'game', opponent: 'Dolphins', winPct: 9 })
    expect(overviewWeekLine({ kind: 'h2h', rank: 12, teams: 14, record: '2-7', opponent: null, winPct: null })).toBeNull()
    expect(overviewWeekLine({ kind: 'alive', rank: 6, outOf: 7, overCut: 12.4, placesAboveCut: 3 })).toEqual({ kind: 'cut' })
    expect(overviewWeekLine({ kind: 'chopped', week: 4 })).toBeNull()
    expect(overviewWeekLine({ kind: 'aliveUnranked', outOf: 9 })).toBeNull()
    expect(overviewWeekLine({ kind: 'preDraft' })).toBeNull()
    expect(overviewWeekLine({ kind: 'none' })).toBeNull()
  })

  it('lists the top six, plus you when you are lower down', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ id: i, isYou: i === 11 }))
    expect(standingsRowsToShow(rows).map((r) => r.id)).toEqual([0, 1, 2, 3, 4, 5, 11])
    const top = rows.map((r) => ({ ...r, isYou: r.id === 2 }))
    expect(standingsRowsToShow(top).map((r) => r.id)).toEqual([0, 1, 2, 3, 4, 5])
    expect(standingsRowsToShow(rows.map((r) => ({ ...r, isYou: false }))).map((r) => r.id)).toEqual([0, 1, 2, 3, 4, 5])
  })
})

describe('<LeagueHome />', () => {
  it('leads with your place and record, then this week on one line', () => {
    const { getByTestId } = render(<LeagueHome data={page()} otherLeagueIssueCount={0} identityInShell />)
    expect(getByTestId('league-overview-guide').querySelector('.af-lho-title')?.textContent).toBe('12th of 14 · 2-7')
    expect(getByTestId('league-overview-week').textContent).toBe('This week vs Dolphins (B2B Champs) · 9% to win →')
  })

  it('keeps Your next steps to what to do: Lineup and Moves', () => {
    const { container } = render(<LeagueHome data={page()} otherLeagueIssueCount={0} identityInShell />)
    const grid = container.querySelector('.af-lh-week-summary-grid')!
    expect(grid.getAttribute('data-cells')).toBe('2')
    expect(grid.children).toHaveLength(2)
    expect(grid.textContent).toContain('Review your starters')
    expect(grid.textContent).toContain('Plan your next move')
    expect(grid.textContent).not.toContain('Dolphins')
  })

  it('says an urgent issue once, in Needs your attention, not again in the Lineup cell', () => {
    const issue = { title: 'Fix 2 starters before kickoff', meta: 'Sleeper › Lineup · locks in 1h', severity: 'bad', glyph: '!', action: null }
    const { container } = render(<LeagueHome data={page()} issues={[issue] as never} otherLeagueIssueCount={0} identityInShell />)
    expect(container.textContent!.split('Fix 2 starters before kickoff')).toHaveLength(2)
    expect(container.querySelector('.af-lh-week-summary')?.textContent).not.toContain('Fix 2 starters')
  })

  it('has no Ask Chimmy card and no second "make changes on Sleeper" line', () => {
    const { container, queryByRole } = render(<LeagueHome data={page()} otherLeagueIssueCount={0} identityInShell />)
    expect(queryByRole('heading', { name: 'Ask Chimmy' })).toBeNull()
    expect(container.textContent).not.toMatch(/AllFantasy only reads your league|Official moves are made on/)
    expect(container.querySelector('.af-lh-side')).toBeNull()
  })

  it('lists standings without the bar chart, with your row when you are lower down, and links the full table', () => {
    const { container, getByTestId } = render(<LeagueHome data={page()} otherLeagueIssueCount={0} identityInShell />)
    expect(container.textContent).not.toContain('Points for by team')
    const rows = [...container.querySelectorAll('.af-standings-row')]
    expect(rows).toHaveLength(7)
    expect(rows[6].getAttribute('data-you')).toBe('true')
    expect(rows[6].textContent).toContain('12')
    expect(rows[6].textContent).toContain('NewYorkJets!')
    expect(getByTestId('league-home-standings-all').getAttribute('href')).toBe('/core/standings?league=lg-1')
  })

  it('says the trade deadline week once, and how long is left', () => {
    const { getByTestId, container } = render(
      <LeagueHome data={page()} tradeDeadline={{ state: 'weeks', deadlineWeek: 12, currentWeek: 10, weeksLeft: 2 }} otherLeagueIssueCount={0} identityInShell />,
    )
    expect(container.querySelector('[data-kpi=trade-deadline] .af-lh-kpi-value')?.textContent).toBe('Week 12')
    expect(getByTestId('league-home-deadline-sub').textContent).toBe('2 weeks left')
  })

  it("says a commissioner's inactive managers in one sentence", () => {
    const commissioner = {
      available: true,
      data: { inactiveCount: 5, atRiskCount: null, totalManagers: 14, inactiveNames: ['Dysfunctional Texans', 'ellocoraider', 'JohnBailey33', 'Pats Nation'],
        basis: 'trades, waiver claims and roster moves in the last 14 days', href: '/core/commissioner?league=lg-1' },
    }
    const { getByTestId } = render(<LeagueHome data={page({ commissioner })} otherLeagueIssueCount={0} identityInShell />)
    expect(getByTestId('league-home-commish-line').textContent!.replace(/\s+/g, ' ').trim())
      .toBe('5 of 14 managers are inactive: Dysfunctional Texans, ellocoraider, JohnBailey33, Pats Nation and 1 more.')
  })

  it('in an elimination league, the line under the headline is the cut', () => {
    const rail = {
      leagueId: 'lg-1', unpaired: true, eliminated: false,
      standing: { rank: 6, outOf: 7, overCut: 12.4, basis: 'points', placesAboveCut: 3, cutLine: 61.2, elimination: true },
    } as unknown as RailMatchup
    const { getByTestId } = render(<LeagueHome data={page()} rail={rail} otherLeagueIssueCount={0} identityInShell />)
    expect(getByTestId('league-overview-week').textContent).toBe('3 places clear of the cut →')
  })

  it('says it in Spanish', () => {
    lang.language = 'es'
    const { getByTestId } = render(
      <LeagueHome data={page()} tradeDeadline={{ state: 'weeks', deadlineWeek: 12, currentWeek: 10, weeksLeft: 1 }} otherLeagueIssueCount={0} identityInShell />,
    )
    expect(getByTestId('league-overview-week').textContent).toBe('Esta semana contra Dolphins (B2B Champs) · 9% de ganar →')
    expect(getByTestId('league-home-standings-all').textContent).toContain('Clasificación completa')
    expect(getByTestId('league-home-deadline-sub').textContent).toBe('Queda 1 semana')
    const steps = document.querySelector('.af-lh-week-summary')!.textContent!
    for (const es of ['Tus próximos pasos', 'Alineación', 'Revisa tus titulares', 'Planea tu próximo movimiento']) expect(steps).toContain(es)
    expect(steps).not.toMatch(/Your next steps|Review your starters|Plan your next move/)
  })
})

describe('the dynasty taxi card', () => {
  const deck = (taxi: DynastyDeck['taxi']): DynastyDeck => ({ clock: { year: 6, season: 2026 }, rafters: null, picks: null, ages: null, taxi })

  it('says the count once', () => {
    const { getByTestId } = render(<DynastyHomeDeck deck={deck({ count: 4, slots: 4 })} leagueId="lg-1" />)
    const card = getByTestId('dynasty-home-taxi')
    expect(card.querySelector('.af-lh-dy-big')?.textContent).toBe('4 of 4slots used — full')
    expect(card.textContent).not.toContain('Taxi squad is full')
    expect(card.querySelector('.af-lh-dy-note')).toBeNull()
  })

  it('says how many are open', () => {
    const { getByTestId } = render(<DynastyHomeDeck deck={deck({ count: 3, slots: 4 })} leagueId="lg-1" />)
    expect(getByTestId('dynasty-home-taxi').querySelector('.af-lh-dy-big span')?.textContent).toBe('slots used — 1 open for a rookie')
  })

  it('with no slot limit, the number is said once too', () => {
    const { getByTestId } = render(<DynastyHomeDeck deck={deck({ count: 2, slots: 0 })} leagueId="lg-1" />)
    expect(getByTestId('dynasty-home-taxi').querySelector('.af-lh-dy-big')?.textContent).toBe('2stashed players')
  })

  it('in Spanish', () => {
    lang.language = 'es'
    const { getByTestId } = render(<DynastyHomeDeck deck={deck({ count: 3, slots: 4 })} leagueId="lg-1" />)
    expect(getByTestId('dynasty-home-taxi').querySelector('.af-lh-dy-big')?.textContent).toBe('3 de 4plazas ocupadas: 1 libre para un novato')
  })
})

describe('copy', () => {
  it('has every new key in both languages and never says «waiver» in Spanish', () => {
    for (const cat of [leagueOverviewGuideMessages, leagueHomeMessages, dynastyHomeDeckMessages]) {
      const en = cat.en as Record<string, unknown>
      const es = cat.es as Record<string, unknown>
      expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
      const text = Object.values(es).map((v) => (typeof v === 'function' ? String((v as (...a: unknown[]) => unknown)(2, 3)) : String(v))).join(' ')
      expect(text).not.toMatch(/waiver/i)
    }
  })
})
