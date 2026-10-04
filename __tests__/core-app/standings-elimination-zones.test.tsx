import React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import { StandingsBoardView, eliminationStatusOf } from '@/components/core-app/standings/StandingsBoardView'
import { Standings } from '@/components/core-app/screens/Standings'
import type { LeagueStandingsResult } from '@/lib/core-app/leagueStandings'
import { advanceWeek, buildStandingsBoard, type StandingsRules, type TeamMeta, type WeekRow, type WeekSnapshot } from '@/lib/core-app/standingsModel'
import { DEFAULT_STANDINGS_VIEW } from '@/lib/core-app/standingsView'

/*
 * Owner's report, 2026-10-03: a guillotine league's Standings drew "★ Bye — top 2", "● Playoffs — top 6"
 * and a playoff line. An elimination league has no playoffs. Given `elimination`, the table reads Safe /
 * On the bubble / Eliminated — the same three as Scout's cards — draws no bye or playoff line, and its
 * legend explains the three instead.
 */

const RULES: StandingsRules = {
  playoffTeams: 2,
  playoffTeamsSource: 'league',
  byes: 1,
  regularSeasonEnd: null,
  tiebreakers: ['points_for', 'head_to_head'],
  tiebreakerSource: 'platform',
  rankIsOfficial: false,
  platformLabel: 'Sleeper',
}
const IDS = ['1', '2', '3', '4']
const row = (week: number, m: number, id: string, pf: number, pa: number): WeekRow => ({ week, rosterId: id, matchupId: m, pointsFor: pf, pointsAgainst: pa })
function snapshots(weeks: number): WeekSnapshot[] {
  const out: WeekSnapshot[] = []
  for (let w = 1; w <= weeks; w += 1) {
    // A guillotine league's shape: one matchup id per roster — nobody plays anybody, points decide.
    const rows = [row(w, 1, '1', 150, 0), row(w, 2, '2', 120, 0), row(w, 3, '3', 110, 0), row(w, 4, '4', 100, 0)]
    out.push(advanceWeek(out[w - 2] ?? null, 2026, w, rows, IDS, `s${w}`))
  }
  return out
}
const teams: TeamMeta[] = IDS.map((id) => ({ rosterId: id, name: `Team ${id}`, avatarUrl: null, isYou: id === '2', division: null, reported: null }))
const board = () => buildStandingsBoard({ season: 2026, snapshots: snapshots(3), unplayed: [], teams, rules: RULES })

beforeEach(() => {
  window.history.replaceState(null, '', '/core/standings?league=L1')
  window.localStorage.clear()
})
afterEach(cleanup)

/** Team name → its chip text in the table ('' for a row with no chip). */
function chipsByTeam(container: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {}
  // The official table only — the power table lists the same teams with no status column.
  for (const tr of container.querySelectorAll('.af-stb-table:not([data-view="power"]) tbody tr')) {
    if (tr.classList.contains('af-stb-line')) continue
    // The team's own cell — other cells (a tiebreak note) can name a different team.
    const name = tr.querySelector('.af-stb-sticky-team')?.textContent?.match(/Team \d/)?.[0]
    // The team's own row comes first; a later row repeating its name (a detail row) carries no chip.
    if (name && !(name in out)) out[name] = tr.querySelector('.af-stb-zone')?.textContent?.replace(/^[^A-Za-z]+/, '') ?? ''
  }
  return out
}

const ZONES = { eliminated: ['4'], bubble: ['2', '3'] }

describe('Standings in an elimination league', () => {
  it('reads Safe / On the bubble / Eliminated, with no playoff vocabulary', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} elimination={ZONES} />)
    expect(chipsByTeam(container)).toEqual({ 'Team 1': 'Safe', 'Team 2': 'On the bubble', 'Team 3': 'On the bubble', 'Team 4': 'Eliminated' })
    expect(container.querySelector('.af-stb-table')!.textContent).not.toMatch(/Bye|Playoffs|Clinched/)
  })

  it('draws no bye or playoff line', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} elimination={ZONES} />)
    expect(container.querySelectorAll('tr.af-stb-line')).toHaveLength(0)
  })

  it('explains Safe, On the bubble and Eliminated in its legend — not Bye or Playoffs', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} elimination={ZONES} />)
    const legend = container.querySelector('.af-stb-legend')!.textContent ?? ''
    expect(legend).toContain('Safe — not in the bottom three this week')
    expect(legend).toContain('On the bubble — the bottom three this week')
    expect(legend).toContain('Eliminated — already chopped')
    expect(legend).not.toMatch(/Bye|Playoffs|Clinched/)
  })

  it('says nothing about safe or bubble while the week cannot be ranked — the chopped team is still Eliminated', () => {
    const { container } = render(
      <StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} elimination={{ eliminated: ['4'], bubble: null }} />,
    )
    expect(chipsByTeam(container)).toEqual({ 'Team 1': '', 'Team 2': '', 'Team 3': '', 'Team 4': 'Eliminated' })
  })

  it('the card layout says the same', () => {
    const { container } = render(
      <StandingsBoardView board={board()} initial={{ ...DEFAULT_STANDINGS_VIEW, layout: 'cards' }} elimination={ZONES} />,
    )
    const chips = [...container.querySelectorAll('.af-stb-card .af-stb-zone')].map((c) => c.textContent?.replace(/^[^A-Za-z]+/, ''))
    expect(chips.sort()).toEqual(['Eliminated', 'On the bubble', 'On the bubble', 'Safe'])
    expect(container.querySelectorAll('.af-stb-cardsep')).toHaveLength(0)
  })

  it('CONTROL: without `elimination` the same board keeps its playoff zones and lines', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    expect(Object.values(chipsByTeam(container)).join(' ')).toMatch(/Bye|Playoffs|Clinched/)
    expect(container.querySelectorAll('tr.af-stb-line').length).toBeGreaterThan(0)
    expect(container.querySelector('.af-stb-legend')!.textContent).toMatch(/Playoffs/)
  })
})

describe('eliminationStatusOf', () => {
  it('chopped wins; then the bubble; then safe; null with no ranked week', () => {
    expect(eliminationStatusOf('4', { eliminated: ['4'], bubble: ['4'] })).toBe('eliminated')
    expect(eliminationStatusOf('3', ZONES)).toBe('bubble')
    expect(eliminationStatusOf('1', ZONES)).toBe('safe')
    expect(eliminationStatusOf('1', { eliminated: [], bubble: null })).toBeNull()
  })
})

describe('the Standings screen tile in an elimination league', () => {
  const data = (): LeagueStandingsResult =>
    ({
      available: true,
      league: { id: 'l1', name: 'Elimination Station 2', platform: 'sleeper' },
      season: 2026,
      week: 4,
      seasonComplete: false,
      teams: IDS.map((id, i) => ({ rosterId: id, name: `Team ${id}`, isYou: id === '2', rank: i + 1, pointsFor: 400 - i * 30, average: 120, weeksPlayed: 3, wins: 0, losses: 0, movement: 0 })),
      you: null,
      trend: [],
      recent: [],
      projection: { available: false, reason: 'this league has no head-to-head schedule, so there is no fixed number of weeks left to project' },
      scoredWeeks: 3,
      history: [],
      board: board(),
    }) as unknown as LeagueStandingsResult

  const tile = (container: HTMLElement) => container.querySelector('.af-st-tile .af-st-tile-s')?.textContent ?? ''

  it('says where the week’s cut leaves you — never "outside the playoffs"', () => {
    const { container } = render(<Standings data={data()} elimination={ZONES} />)
    expect(tile(container)).toMatch(/of 4 · on the bubble this week/)
    expect(container.textContent).not.toMatch(/outside the playoffs|in a playoff spot|in a bye spot/)
  })

  it('CONTROL: without `elimination` the tile keeps its playoff wording', () => {
    const { container } = render(<Standings data={data()} />)
    expect(tile(container)).toMatch(/bye|playoff|bubble|clinched|eliminated/i)
    expect(tile(container)).not.toMatch(/this week/)
  })
})
