import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

import { StandingsBoardView } from '@/components/core-app/standings/StandingsBoardView'
import { advanceWeek, buildStandingsBoard, type StandingsRules, type WeekRow, type WeekSnapshot } from '@/lib/core-app/standingsModel'
import { DEFAULT_STANDINGS_VIEW } from '@/lib/core-app/standingsView'

/*
 * The phone list: each card folds to one row, the bye and playoff lines are drawn between rows, a
 * phone that never chose a layout gets the list, and the method notes fold behind one summary.
 */

const RULES: StandingsRules = {
  playoffTeams: 4,
  playoffTeamsSource: 'league',
  byes: 2,
  regularSeasonEnd: null,
  tiebreakers: ['points_for', 'head_to_head'],
  tiebreakerSource: 'platform',
  rankIsOfficial: false,
  platformLabel: 'Sleeper',
}

function board() {
  const ids = ['1', '2', '3', '4', '5', '6']
  const weeks: Array<Array<[string, number, string, number]>> = [
    [['1', 140, '6', 90], ['2', 130, '5', 95], ['3', 120, '4', 100]],
    [['1', 135, '5', 92], ['2', 125, '4', 98], ['3', 118, '6', 101]],
  ]
  const snaps: WeekSnapshot[] = []
  weeks.forEach((games, w) => {
    const rows: WeekRow[] = games.flatMap(([a, pa, b, pb], m) => [
      { week: w + 1, rosterId: a, matchupId: m + 1, pointsFor: pa, pointsAgainst: pb },
      { week: w + 1, rosterId: b, matchupId: m + 1, pointsFor: pb, pointsAgainst: pa },
    ])
    snaps.push(advanceWeek(snaps[snaps.length - 1] ?? null, 2026, w + 1, rows, ids, `s${w + 1}`))
  })
  return buildStandingsBoard({
    season: 2026,
    snapshots: snaps,
    unplayed: [],
    teams: ids.map((id) => ({ rosterId: id, name: `Team ${id}`, avatarUrl: null, isYou: id === '3', division: null, reported: null })),
    rules: RULES,
  })
}

function phone(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
}

beforeEach(() => {
  window.history.replaceState(null, '', '/core/standings?league=L1')
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('cards fold to one row per team', () => {
  it('puts the record in each summary, opens only your own card, and keeps the full sheet in the DOM', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={{ ...DEFAULT_STANDINGS_VIEW, layout: 'cards' }} />)
    const folds = [...container.querySelectorAll('details.af-stb-cardfold')] as HTMLDetailsElement[]
    expect(folds).toHaveLength(6)
    const open = folds.filter((d) => d.open)
    expect(open).toHaveLength(1)
    expect(open[0].querySelector('summary')?.textContent).toContain('Team 3')

    const first = folds[0]
    expect(first.querySelector('summary .af-stb-cardkey')?.textContent).toBe('2-0')
    /* Folded is not removed: the stat sheet is still there for search and screen readers. */
    expect(first.querySelector('dl.af-stb-carddl')?.textContent).toContain('Points for')
  })

  it('draws the bye and playoff lines between rows in table order', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={{ ...DEFAULT_STANDINGS_VIEW, layout: 'cards' }} />)
    const items = [...container.querySelectorAll('.af-stb-cards > li')]
    const seps = items.map((li, i) => (li.classList.contains('af-stb-cardsep') ? `${i}:${li.getAttribute('data-line')}` : null)).filter(Boolean)
    /* Two teams, then the bye line; two more, then the playoff line. */
    expect(seps).toEqual(['2:bye', '5:playoff'])
    expect(container.querySelector('.af-stb-cardsep[data-line="playoff"]')?.textContent).toBe('Playoff line — top 4 make it')
  })

  it('draws no lines in the AF Power order, where they would mark nothing', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={{ ...DEFAULT_STANDINGS_VIEW, view: 'power', layout: 'cards' }} />)
    expect(container.querySelector('.af-stb-cardsep')).toBeNull()
  })
})

describe('a phone that never chose a layout gets the list', () => {
  it('switches to the list on a phone, without writing that default into the URL', async () => {
    phone(true)
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    await act(async () => {})
    expect(container.querySelector('.af-stb-cardwrap')).not.toBeNull()
    /* A link copied on a phone must not open a desktop in the list. */
    expect(window.location.search).not.toContain('st_layout')
  })

  it('keeps the table on a wide screen', async () => {
    phone(false)
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    await act(async () => {})
    expect(container.querySelector('.af-stb-cardwrap')).toBeNull()
  })

  it('honours a phone that chose the table before', async () => {
    phone(true)
    window.localStorage.setItem('af-standings-layout', 'table')
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    await act(async () => {})
    expect(container.querySelector('.af-stb-cardwrap')).toBeNull()
  })

  it('honours a layout the URL names', async () => {
    phone(true)
    window.history.replaceState(null, '', '/core/standings?league=L1&st_layout=table')
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    await act(async () => {})
    expect(container.querySelector('.af-stb-cardwrap')).toBeNull()
  })
})

describe('the method notes fold behind one summary', () => {
  it('keeps every note, under "How this table works"', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    const how = container.querySelector('details.af-stb-how') as HTMLDetailsElement
    expect(how.open).toBe(false)
    expect(how.querySelector('summary')?.textContent).toBe('How this table works')
    expect(how.textContent).toMatch(/Top 4 make the playoffs/)
  })
})
