import React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { StandingsBoardView } from '@/components/core-app/standings/StandingsBoardView'
import {
  advanceWeek,
  buildStandingsBoard,
  type RemainingGame,
  type StandingsRules,
  type TeamMeta,
  type WeekRow,
  type WeekSnapshot,
} from '@/lib/core-app/standingsModel'
import { DEFAULT_STANDINGS_VIEW, parseStandingsView, serializeStandingsView } from '@/lib/core-app/standingsView'

/*
 * The standings board, rendered: two tables that must never be confused, a projection that must never
 * read as a result, a card layout that drops nothing, and view state that survives in the URL.
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
const EAST = { key: 'e', name: 'East' }
const WEST = { key: 'w', name: 'West' }

function row(week: number, m: number, id: string, pf: number, pa: number): WeekRow {
  return { week, rosterId: id, matchupId: m, pointsFor: pf, pointsAgainst: pa }
}

function snapshots(weeks: number): WeekSnapshot[] {
  const out: WeekSnapshot[] = []
  for (let w = 1; w <= weeks; w += 1) {
    const rows = [
      row(w, 1, '1', 150, 120 + w),
      row(w, 1, '2', 120 + w, 150),
      // 3 and 4 trade wins, and score the same total, so they sit level on record and points.
      row(w, 2, '3', w % 2 ? 110 : 100, w % 2 ? 100 : 110),
      row(w, 2, '4', w % 2 ? 100 : 110, w % 2 ? 110 : 100),
    ]
    out.push(advanceWeek(out[w - 2] ?? null, 2026, w, rows, IDS, `s${w}`))
  }
  return out
}

function teams(divisions = false): TeamMeta[] {
  return IDS.map((id) => ({
    rosterId: id,
    name: `Team ${id}`,
    avatarUrl: null,
    isYou: id === '2',
    division: divisions ? (id === '1' || id === '3' ? EAST : WEST) : null,
    reported: null,
  }))
}

function board(opts: { weeks?: number; divisions?: boolean; unplayed?: RemainingGame[] } = {}) {
  return buildStandingsBoard({
    season: 2026,
    snapshots: snapshots(opts.weeks ?? 4),
    unplayed: opts.unplayed ?? [
      { week: 5, a: '1', b: '3' },
      { week: 5, a: '2', b: '4' },
      { week: 6, a: '1', b: '4' },
      { week: 6, a: '2', b: '3' },
    ],
    teams: teams(opts.divisions),
    rules: RULES,
  })
}

beforeEach(() => {
  window.history.replaceState(null, '', '/core/standings?league=L1')
  window.localStorage.clear()
})
afterEach(cleanup)

describe('StandingsBoardView — official table', () => {
  it('freezes the rank and team columns', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    const firstRow = container.querySelector('.af-stb-table tbody tr[data-zone]')!
    expect(firstRow.children[0].className).toContain('af-stb-sticky-rank')
    expect(firstRow.children[1].className).toContain('af-stb-sticky-team')
    expect(container.querySelectorAll('thead .af-stb-sticky')).toHaveLength(2)
  })

  it('draws the bye line and the playoff line between the right rows', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    const lines = [...container.querySelectorAll('tr.af-stb-line')]
    expect(lines.map((l) => l.getAttribute('data-line'))).toEqual(['bye', 'playoff'])
    expect(lines[1].textContent).toMatch(/Playoff line — top 2 make it/)
    // The playoff line sits directly after seed 2.
    expect(lines[1].previousElementSibling?.querySelector('td')?.textContent).toBe('2')
  })

  it('names every zone in words, not colour alone', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    const chips = [...container.querySelectorAll('.af-stb-table .af-stb-zone')].map((c) => c.textContent)
    expect(chips.length).toBe(4)
    for (const text of chips) expect(text).toMatch(/Bye|Playoffs|Bubble|Out|Eliminated|Clinched/)
  })

  it('explains a tie in the row and answers "why is A above B"', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    const tb = container.querySelector('.af-stb-tb p')
    expect(tb?.textContent).toMatch(/Level at 2-2/)
    const answer = container.querySelector('.af-stb-why-answer')!
    // Defaults to you and the team directly above you.
    expect(answer.textContent).toBe('Team 4 is 3rd, Team 2 4th. Team 4 has the better record (2-2 to 0-4) — no tiebreaker needed.')
  })

  it('hatches and tags the projection, and keeps the actual record apart', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    const projHeads = [...container.querySelectorAll('thead th.af-stb-proj')]
    expect(projHeads).toHaveLength(2)
    for (const h of projHeads) expect(h.querySelector('.af-stb-projtag')?.textContent).toBe('Model')
    const you = container.querySelector('tr[data-you="true"]')!
    const cells = [...you.querySelectorAll('td')]
    expect(cells.some((c) => c.textContent === '0-4' && !c.classList.contains('af-stb-proj'))).toBe(true)
    // Two games left, each ~85% for a team scoring 122 against two scoring 105: projected 2-4.
    expect(cells.some((c) => c.classList.contains('af-stb-proj') && c.textContent === '2-4')).toBe(true)
  })

  it('says why projections are missing instead of drawing empty columns', () => {
    const { container } = render(<StandingsBoardView board={board({ weeks: 2 })} initial={DEFAULT_STANDINGS_VIEW} />)
    expect(container.querySelectorAll('th.af-stb-proj')).toHaveLength(0)
    expect(container.querySelector('.af-stb-projnote')?.textContent).toMatch(/once 3 weeks are final/)
  })
})

describe('StandingsBoardView — power, cards, divisions', () => {
  it('labels AF Power as analysis and writes the view to the URL', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    fireEvent.click(screen.getByRole('radio', { name: 'AF Power' }))
    expect(container.querySelector('.af-stb-kind')?.textContent).toMatch(/AllFantasy analysis — not the league table/)
    expect(container.querySelector('table[data-view="power"]')).not.toBeNull()
    // No playoff line and no projection in the analysis table.
    expect(container.querySelectorAll('tr.af-stb-line')).toHaveLength(0)
    expect(container.querySelectorAll('.af-stb-proj')).toHaveLength(0)
    expect(window.location.search).toContain('st_view=power')
    expect(window.location.search).toContain('league=L1')
  })

  it('renders every team as a labelled card, and remembers the choice', () => {
    render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Cards' }))
    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(4)
    const you = cards.find((c) => c.getAttribute('data-you') === 'true')!
    expect(within(you).getByRole('heading').textContent).toMatch(/Position 4: Team 2/)
    expect(within(you).getByText('Record')).toBeTruthy()
    expect(within(you).getByText('Points against')).toBeTruthy()
    expect(you.querySelector('.af-stb-cardproj')?.textContent).toMatch(/Model.*an expectation, not a result/)
    expect(window.location.search).toContain('st_layout=cards')
    expect(window.localStorage.getItem('af-standings-layout')).toBe('cards')
  })

  it('applies a remembered card layout only when the URL did not choose', () => {
    window.localStorage.setItem('af-standings-layout', 'cards')
    const { unmount } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    expect(screen.getAllByRole('article')).toHaveLength(4)
    unmount()
    window.history.replaceState(null, '', '/core/standings?league=L1&st_layout=table')
    render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  })

  it('offers no division control for a league without divisions', () => {
    render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    expect(screen.queryByLabelText('Divisions')).toBeNull()
  })

  it('groups by division without losing the overall position', () => {
    const { container } = render(<StandingsBoardView board={board({ divisions: true })} initial={DEFAULT_STANDINGS_VIEW} />)
    fireEvent.change(screen.getByLabelText('Divisions'), { target: { value: 'group' } })
    const groups = [...container.querySelectorAll('tr.af-stb-grouprow')].map((g) => g.textContent)
    expect(groups).toEqual(['East', 'West'])
    const west = container.querySelectorAll('tbody')[1]
    const seeds = [...west.querySelectorAll('tr[data-zone] td.af-stb-sticky-rank')].map((c) => c.textContent)
    expect(seeds).toEqual(['3', '4'])
    // The line is a whole-league line; it is not drawn inside a division group.
    expect(container.querySelectorAll('tr.af-stb-line')).toHaveLength(0)
    expect(window.location.search).toContain('st_div=group')
  })

  it('filters to one division', () => {
    const { container } = render(
      <StandingsBoardView board={board({ divisions: true })} initial={{ ...DEFAULT_STANDINGS_VIEW, division: 'e' }} />,
    )
    const names = [...container.querySelectorAll('tr[data-zone] .af-stb-teamname')].map((n) => n.textContent)
    expect(names).toEqual(['Team 1', 'Team 3'])
  })
})

describe('StandingsBoardView — charts and notes', () => {
  it('draws one line per team and highlights yours', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    const series = container.querySelectorAll('.af-stb-series')
    expect(series).toHaveLength(4)
    expect(container.querySelectorAll('.af-stb-series[data-tone="you"]')).toHaveLength(1)
    // Every value is reachable without hovering.
    expect(container.querySelector('.af-stb-datatable table')).not.toBeNull()
  })

  it('traces a team from the keyboard', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    fireEvent.focus(screen.getByRole('button', { name: 'Team 3' }))
    expect(container.querySelectorAll('.af-stb-series[data-tone="hover"]')).toHaveLength(1)
  })

  it('says the history needs two weeks rather than drawing one point', () => {
    render(<StandingsBoardView board={board({ weeks: 1 })} initial={DEFAULT_STANDINGS_VIEW} />)
    expect(screen.getByText(/history starts once two weeks are final/)).toBeTruthy()
  })

  it('plots points for against points against and wins against expected wins', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    expect(container.querySelectorAll('.af-stb-point')).toHaveLength(4)
    expect(container.querySelectorAll('.af-stb-dumbbell')).toHaveLength(4)
    expect(screen.getByText('Wins vs expected wins')).toBeTruthy()
  })

  it('says a week is still being played', () => {
    const b = { ...board(), pendingWeeks: [5], throughWeek: 4 }
    render(<StandingsBoardView board={b} initial={DEFAULT_STANDINGS_VIEW} />)
    expect(screen.getByRole('note').textContent).toMatch(/Week 5 is still being played.*through week 4.*Sleeper/)
  })
})

describe('standings view state', () => {
  it('parses and serialises, defaults omitted', () => {
    const state = parseStandingsView((k) => ({ st_view: 'power', st_div: 'group', st_layout: 'cards' })[k])
    expect(state).toEqual({ view: 'power', division: 'group', layout: 'cards' })
    expect(serializeStandingsView(DEFAULT_STANDINGS_VIEW)).toEqual([])
    expect(parseStandingsView(() => ['power', 'x'])).toEqual({ view: 'power', division: 'power', layout: 'table' })
    expect(parseStandingsView(() => 'nonsense').view).toBe('official')
  })
})
