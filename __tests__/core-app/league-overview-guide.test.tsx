import React from 'react'
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The league Overview guide (2026-11-13). Found on the owner's account: the Overview never said how you
 * were doing; on Guillotine League 26 it read "Record 0-0 · 2nd of 18" while the rail said "6th of 7
 * alive · +12.4 over the cut", offered "Open matchup" in a league with no matchups, and ran 13 sections
 * long. Pinned here: the headline per format, read from the rail's own standing for an elimination league;
 * the cut in place of a matchup; Draft HQ only before the draft; reference sections folded.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams('league=lg-1'),
}))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ canConfirm: false }), { status: 200 }))))
})
afterEach(() => vi.unstubAllGlobals())

import { LeagueHome } from '@/components/core-app/screens/LeagueHome'
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'
import type { RailMatchup } from '@/lib/core-app/railMatchups'
import { isEliminationLeague, overviewHeadline } from '@/lib/core-app/leagueOverviewGuide'

const off = { available: false as const, reason: 'not in this fixture' }

function page(over: Partial<Record<string, unknown>> = {}): LeagueHomeData {
  return {
    pairing: null,
    league: { id: 'lg-1', name: 'Kings', platform: 'sleeper', format: 'Redraft', sport: 'NFL', season: 2026, currentWeek: 10 },
    importCoverage: { capabilities: {}, missing: [], partial: [], sentence: '', hasGaps: false },
    yourTeam: { available: true, data: { record: '5-4', rank: 6 } },
    stage: null,
    preSeason: false,
    rosteredPlayerCount: 150,
    weekPicker: null,
    standings: {
      available: true,
      data: Array.from({ length: 12 }, (_, i) => ({
        teamId: `t${i}`, teamName: i === 5 ? 'Tenzi SF' : `Team ${i + 1}`, rank: i + 1, wins: 5, losses: 4, ties: 0,
        pointsFor: 1200 - i * 10, isYou: i === 5, faabRemaining: null,
      })),
    },
    timeline: off,
    matchup: {
      available: true,
      data: { week: 10, season: 2026, you: { name: 'Tenzi SF', points: 0 }, opponent: { name: 'Wounded Warriors Project', points: 0 },
        winProbability: { pWin: 0.54, detail: '', confidence: 'medium' } },
    },
    draftHq: { available: true, data: { headline: 'Draft complete', detail: '', href: '/core/draft-hq?league=lg-1', linkLabel: 'Open board' } },
    commissioner: off,
    buzz: off,
    scoreboard: off,
    powerBoard: off,
    rivalry: off,
    syncAge: { label: '3m ago', stale: false },
    ...over,
  } as unknown as LeagueHomeData
}

const railStanding = (over: Partial<NonNullable<RailMatchup['standing']>> = {}): RailMatchup =>
  ({
    leagueId: 'lg-1', unpaired: true, eliminated: false,
    standing: { rank: 6, outOf: 7, overCut: 12.4, basis: 'points', placesAboveCut: 3, cutLine: 61.2, elimination: true, ...over },
  }) as unknown as RailMatchup

describe('overviewHeadline', () => {
  it('head-to-head: place, record and this week’s opponent', () => {
    expect(overviewHeadline({ rail: null, preDraft: false, record: { record: '5-4', rank: 6, teams: 12 }, matchup: { opponent: 'WWP', pWin: 0.54 } }))
      .toEqual({ kind: 'h2h', rank: 6, teams: 12, record: '5-4', opponent: 'WWP', winPct: 54 })
  })

  it('elimination: the rail’s standing, never the W-L record', () => {
    expect(overviewHeadline({ rail: railStanding(), preDraft: false, record: { record: '0-0', rank: 2, teams: 18 }, matchup: null }))
      .toEqual({ kind: 'alive', rank: 6, outOf: 7, overCut: 12.4, placesAboveCut: 3 })
  })

  it('a chopped team is told so', () => {
    expect(overviewHeadline({ rail: { ...railStanding(), eliminated: true, standing: null } as RailMatchup, preDraft: false, record: null, matchup: null }).kind).toBe('chopped')
  })

  it('a native guillotine line counts as elimination, and its margin reads as points over the cut', () => {
    const rail = { leagueId: 'x', guillotine: { state: 'alive', rank: 3, aliveCount: 9, chopMargin: 8.5, choppedWeek: null } } as unknown as RailMatchup
    expect(isEliminationLeague(rail)).toBe(true)
    expect(overviewHeadline({ rail, preDraft: false, record: null, matchup: null })).toMatchObject({ kind: 'alive', rank: 3, outOf: 9, overCut: 8.5 })
  })

  it('a dynasty league with an axe in its NAME is not elimination — only the rail or the variant says so', () => {
    expect(isEliminationLeague(null, null)).toBe(false)
    expect(isEliminationLeague(null, 'guillotine')).toBe(true)
  })
})

describe('<LeagueHome /> — the guide', () => {
  it('a head-to-head league leads with place and record, and says this week once, on the line under it', () => {
    const { getByTestId, container } = render(<LeagueHome data={page()} otherLeagueIssueCount={0} identityInShell />)
    const head = getByTestId('league-overview-guide')
    expect(head.querySelector('.af-lho-title')?.textContent).toBe('6th of 12 · 5-4')
    expect(head.querySelector('[data-chip=win]')).toBeNull()
    const week = getByTestId('league-overview-week')
    expect(week.textContent).toBe('This week vs Wounded Warriors Project · 54% to win →')
    expect(week.getAttribute('href')).toBe('/core/matchup?league=' + encodeURIComponent(page().league.id))
    // The opponent and the win chance are not said again under "Your next steps".
    expect(container.querySelector('.af-lh-week-summary')?.textContent).not.toContain('54% to win')
    expect(container.querySelector('.af-lh-week-summary')?.textContent).not.toContain('Wounded Warriors Project')
    expect(container.querySelector('.af-lh-week-summary a[href^="/core/matchup"]')).toBeNull()
    // Where official moves happen is said by the banner above every tab, not again here.
    expect(head.textContent).not.toMatch(/Official moves|Why it matters/)
    // The guide comes before the KPI row and the week summary.
    const order = [...container.querySelectorAll('[data-testid=league-overview-guide], [data-testid=league-home-kpis], .af-lh-week-summary')].map(
      (e) => e.getAttribute('data-testid') ?? 'week',
    )
    expect(order).toEqual(['league-overview-guide', 'league-home-kpis', 'week'])
  })

  it('an elimination league says where it stands against the cut, drops the record, and offers the cut instead of a matchup', () => {
    const { getByTestId, container } = render(<LeagueHome data={page()} otherLeagueIssueCount={0} identityInShell rail={railStanding()} />)
    expect(getByTestId('league-overview-guide').querySelector('.af-lho-title')?.textContent).toBe('6th of 7 still alive · 12.4 points over the cut')
    expect(container.querySelector('[data-kpi=record]')).toBeNull()
    const cut = getByTestId('league-overview-week')
    // The headline says the points; the line says the places — each number once.
    expect(cut.getAttribute('data-week')).toBe('cut')
    expect(cut.textContent).toContain('3 places clear of the cut')
    expect(cut.textContent).not.toContain('12.4')
    expect(cut.getAttribute('href')).toMatch(/^\/core\/standings/)
    expect(container.querySelector('.af-lh-week-summary [data-cell=cut]')).toBeNull()
    expect(container.querySelector('.af-lh-week-summary a[href^="/core/matchup"]')).toBeNull()
  })

  it('keeps Draft HQ out of the main page after the draft, and folds the reference sections', () => {
    const { getByTestId, container } = render(<LeagueHome data={page()} otherLeagueIssueCount={0} identityInShell />)
    const more = getByTestId('league-overview-more')
    expect(more.hasAttribute('open')).toBe(false)
    expect(more.textContent).toContain('Draft HQ')
    // Draft HQ is inside the fold and nowhere else.
    const draftTitles = [...container.querySelectorAll('h2')].filter((h) => h.textContent === 'Draft HQ')
    expect(draftTitles.length).toBe(1)
    expect(more.contains(draftTitles[0]!)).toBe(true)
  })

  it('before the draft, Draft HQ is on the page, not folded', () => {
    const { getByTestId, container } = render(
      <LeagueHome data={page({ preSeason: true, rosteredPlayerCount: 0, yourTeam: off, matchup: off })} otherLeagueIssueCount={0} identityInShell />,
    )
    expect(getByTestId('league-overview-guide').querySelector('.af-lho-title')?.textContent).toBe('Before the draft')
    const draft = [...container.querySelectorAll('h2')].find((h) => h.textContent === 'Draft HQ')!
    expect(getByTestId('league-overview-more').contains(draft)).toBe(false)
  })
})
