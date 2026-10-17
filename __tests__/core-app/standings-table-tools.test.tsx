import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'

import { StandingsBoardView } from '@/components/core-app/standings/StandingsBoardView'
import {
  advanceWeek,
  buildStandingsBoard,
  type BoardTeam,
  type ReportedRecord,
  type StandingsRules,
  type TeamMeta,
  type WeekRow,
  type WeekSnapshot,
} from '@/lib/core-app/standingsModel'
import { sortTeams } from '@/lib/core-app/standingsSort'
import type { StandingsOdds } from '@/lib/core-app/standingsOdds'
import { DEFAULT_STANDINGS_VIEW, parseStandingsView, serializeStandingsView } from '@/lib/core-app/standingsView'

/*
 * The league table's tools: sortable columns, your row kept in reach, streaks and the median split,
 * the head-to-head grid, and the "if scores held" switch.
 */

const RULES: StandingsRules = {
  playoffTeams: 2,
  playoffTeamsSource: 'league',
  byes: 0,
  regularSeasonEnd: null,
  tiebreakers: ['points_for', 'head_to_head'],
  tiebreakerSource: 'platform',
  rankIsOfficial: false,
  platformLabel: 'Sleeper',
}

const IDS = ['1', '2', '3', '4']

function row(week: number, m: number, id: string, pf: number, pa: number): WeekRow {
  return { week, rosterId: id, matchupId: m, pointsFor: pf, pointsAgainst: pa }
}

/** 1 beats 2 every week; 3 and 4 trade wins. After four weeks: 1 4-0, 3 2-2, 4 2-2, 2 0-4 (you). */
function snapshots(weeks: number): WeekSnapshot[] {
  const out: WeekSnapshot[] = []
  for (let w = 1; w <= weeks; w += 1) {
    const rows = [
      row(w, 1, '1', 150, 120 + w),
      row(w, 1, '2', 120 + w, 150),
      row(w, 2, '3', w % 2 ? 110 : 100, w % 2 ? 100 : 110),
      row(w, 2, '4', w % 2 ? 100 : 110, w % 2 ? 110 : 100),
    ]
    out.push(advanceWeek(out[w - 2] ?? null, 2026, w, rows, IDS, `s${w}`))
  }
  return out
}

function teams(reported: Record<string, Partial<ReportedRecord>> = {}): TeamMeta[] {
  return IDS.map((id) => ({
    rosterId: id,
    name: `Team ${id}`,
    avatarUrl: null,
    isYou: id === '2',
    division: null,
    reported: reported[id] ? { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: null, rank: null, ...reported[id] } : null,
  }))
}

const UNPLAYED = [
  { week: 5, a: '1', b: '3' },
  { week: 5, a: '2', b: '4' },
  { week: 6, a: '1', b: '4' },
  { week: 6, a: '2', b: '3' },
]

function board() {
  return buildStandingsBoard({ season: 2026, snapshots: snapshots(4), unplayed: UNPLAYED, teams: teams(), rules: RULES })
}

const ODDS: StandingsOdds = {
  byRoster: {
    '1': { playoffPct: 97, byePct: 0, modelled: true, sosRank: 4, sosOpponentMu: 104 },
    '2': { playoffPct: 1.5, byePct: 0, modelled: true, sosRank: 3, sosOpponentMu: 105 },
    '3': { playoffPct: 60, byePct: 0, modelled: true, sosRank: 1, sosOpponentMu: 140 },
    '4': { playoffPct: 41, byePct: 0, modelled: true, sosRank: 2, sosOpponentMu: 138 },
  },
  sosRanked: 4,
  leagueMu: 121,
  iterations: 10_000,
  you: null,
  stakes: null,
  basis: '',
  href: '/core/season-outlook?league=L1',
}

const leagueTable = (c: HTMLElement) => c.querySelector('[aria-label="League table"]') as HTMLElement
const rowNames = (c: HTMLElement) =>
  [...leagueTable(c).querySelectorAll('tbody tr[data-zone] .af-stb-teamname')].map((e) => e.textContent)

beforeEach(() => {
  window.history.replaceState(null, '', '/core/standings?league=L1')
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('sortTeams', () => {
  const b = board()
  const team = (id: string) => b.teams.find((t) => t.rosterId === id)!

  it('leaves table order alone, and sorts by a column with ties falling back to the seed', () => {
    expect(sortTeams(b.teams, { key: 'seed', dir: 'asc' }, null)).toBe(b.teams)
    expect(sortTeams(b.teams, { key: 'pf', dir: 'desc' }, null).map((t) => t.rosterId)).toEqual(['1', '2', '3', '4'].sort(
      (x, y) => team(y).pointsFor - team(x).pointsFor || team(x).seed - team(y).seed,
    ))
    expect(sortTeams(b.teams, { key: 'seed', dir: 'desc' }, null).map((t) => t.seed)).toEqual([4, 3, 2, 1])
  })

  it('sinks a team with no value in BOTH directions', () => {
    const partial = { ...ODDS, byRoster: { '1': ODDS.byRoster['1'], '3': ODDS.byRoster['3'] } }
    const desc = sortTeams(b.teams, { key: 'odds', dir: 'desc' }, partial).map((t) => t.rosterId)
    const asc = sortTeams(b.teams, { key: 'odds', dir: 'asc' }, partial).map((t) => t.rosterId)
    expect(desc.slice(0, 2)).toEqual(['1', '3'])
    expect(asc.slice(0, 2)).toEqual(['3', '1'])
    // The two unknowns stay at the bottom, in table order, either way.
    const unknowns = b.teams.filter((t) => t.rosterId === '2' || t.rosterId === '4').map((t) => t.rosterId)
    expect(desc.slice(2)).toEqual(unknowns)
    expect(asc.slice(2)).toEqual(unknowns)
  })

  it('reads a streak as signed length, so W3 sorts above L1', () => {
    const fake = (id: string, result: 'W' | 'L', length: number, seed: number) =>
      ({ rosterId: id, seed, streak: { result, length } }) as unknown as BoardTeam
    const list = [fake('x', 'L', 1, 1), fake('y', 'W', 3, 2), fake('z', 'W', 1, 3)]
    expect(sortTeams(list, { key: 'streak', dir: 'desc' }, null).map((t) => t.rosterId)).toEqual(['y', 'z', 'x'])
  })
})

describe('sort in the URL', () => {
  it('round-trips, omits defaults, and gives each column its natural first direction', () => {
    expect(parseStandingsView((k) => ({ st_sort: 'pf' })[k]).sort).toEqual({ key: 'pf', dir: 'desc' })
    expect(parseStandingsView((k) => ({ st_sort: 'sos' })[k]).sort).toEqual({ key: 'sos', dir: 'asc' })
    expect(parseStandingsView((k) => ({ st_sort: 'pf', st_dir: 'asc' })[k]).sort).toEqual({ key: 'pf', dir: 'asc' })
    expect(parseStandingsView((k) => ({ st_sort: 'nonsense' })[k]).sort).toEqual({ key: 'seed', dir: 'asc' })
    expect(serializeStandingsView({ ...DEFAULT_STANDINGS_VIEW, sort: { key: 'pf', dir: 'desc' } })).toEqual([['st_sort', 'pf']])
    expect(serializeStandingsView({ ...DEFAULT_STANDINGS_VIEW, sort: { key: 'pf', dir: 'asc' } })).toEqual([
      ['st_sort', 'pf'],
      ['st_dir', 'asc'],
    ])
  })
})

describe('StandingsBoardView — sorting', () => {
  it('sorts on a heading, flips on a second press, hides the playoff line, and resets', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} odds={ODDS} />)
    expect(container.querySelector('tr.af-stb-line')).not.toBeNull()
    const button = (label: RegExp) => within(leagueTable(container)).getByRole('button', { name: label })

    fireEvent.click(button(/^Playoff odds/))
    expect(rowNames(container)).toEqual(['Team 1', 'Team 3', 'Team 4', 'Team 2'])
    expect(button(/^Playoff odds/).closest('th')?.getAttribute('aria-sort')).toBe('descending')
    expect(container.querySelector('tr.af-stb-line')).toBeNull()
    expect(container.querySelector('.af-stb-sorted')?.textContent).toMatch(/Sorted by playoff odds/)
    expect(window.location.search).toContain('st_sort=odds')

    fireEvent.click(button(/^Playoff odds/))
    expect(rowNames(container)).toEqual(['Team 2', 'Team 4', 'Team 3', 'Team 1'])
    expect(window.location.search).toContain('st_dir=asc')

    fireEvent.click(within(container.querySelector('.af-stb-sorted') as HTMLElement).getByRole('button', { name: /Back to table order/ }))
    expect(rowNames(container)).toEqual(['Team 1', 'Team 3', 'Team 4', 'Team 2'])
    expect(container.querySelector('tr.af-stb-line')).not.toBeNull()
    expect(window.location.search).not.toContain('st_sort')
  })

  it('ignores a sort on a column that is not on screen', () => {
    const initial = { ...DEFAULT_STANDINGS_VIEW, sort: { key: 'odds' as const, dir: 'desc' as const } }
    const { container } = render(<StandingsBoardView board={board()} initial={initial} />)
    expect(rowNames(container)).toEqual(['Team 1', 'Team 3', 'Team 4', 'Team 2'])
    expect(container.querySelector('.af-stb-sorted')).toBeNull()
  })
})

describe('StandingsBoardView — streak, median split and head to head', () => {
  it('shows each team’s streak in its own column', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    const streaks = [...leagueTable(container).querySelectorAll('.af-stb-streak')].map((e) => e.firstChild?.textContent + (e.childNodes[1]?.textContent ?? ''))
    // 1 has won four straight; 2 has lost four.
    expect(streaks[0]).toBe('W4')
    expect(streaks[streaks.length - 1]).toBe('L4')
  })

  it('takes a median league’s record apart into H2H and Median columns', () => {
    // b loses to a but finishes top-half; c beats d but does not.
    const rows = [row(1, 1, '1', 130, 125), row(1, 1, '2', 125, 130), row(1, 2, '3', 90, 70), row(1, 2, '4', 70, 90)]
    const median = buildStandingsBoard({
      season: 2026,
      snapshots: [advanceWeek(null, 2026, 1, rows, IDS, 's1')],
      unplayed: [],
      teams: teams({ '1': { wins: 2 }, '2': { wins: 1, losses: 1 }, '3': { wins: 1, losses: 1 }, '4': { losses: 2 } }),
      rules: RULES,
    })
    expect(median.medianGames).toBe(true)
    const { container } = render(<StandingsBoardView board={median} initial={DEFAULT_STANDINGS_VIEW} />)
    const heads = [...leagueTable(container).querySelectorAll('thead th')].map((th) => th.textContent?.replace(/[▲▼↕]/g, ''))
    expect(heads).toEqual(expect.arrayContaining(['H2H', 'Median']))
    const you = leagueTable(container).querySelector('tr[data-you="true"]')!
    const cells = [...you.querySelectorAll('td')].map((td) => td.textContent)
    // You (Team 2): 1-1 overall, 0-1 head-to-head, 1-0 median.
    expect(cells.slice(2, 5)).toEqual(['1-1', '0-1', '1-0'])
  })

  it('draws every head-to-head record, read across', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    const grid = container.querySelector('[aria-label="Head-to-head records"]') as HTMLElement
    expect(grid).not.toBeNull()
    const rowOf = (name: string) => [...grid.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('.af-stb-teamname')?.textContent === name)!
    // Columns are in table order: 1, 3, 4, 2.
    const cells = (name: string) => [...rowOf(name).querySelectorAll('td.af-stb-h2h-cell')]
    expect(cells('Team 1')[3].textContent).toMatch(/^4-0/)
    expect(cells('Team 1')[3].getAttribute('data-res')).toBe('w')
    expect(cells('Team 2')[0].textContent).toMatch(/^0-4/)
    expect(cells('Team 2')[0].getAttribute('data-res')).toBe('l')
    expect(cells('Team 3')[2].textContent).toMatch(/^2-2/)
    expect(cells('Team 3')[2].getAttribute('data-res')).toBe('even')
    // Teams that never met read as not played, not as 0-0.
    expect(cells('Team 1')[2].textContent).toMatch(/has not played Team 4/)
    expect(cells('Team 1')[0].getAttribute('data-self')).toBe('true')
  })
})

describe('StandingsBoardView — if scores held', () => {
  // Week five is live: 3 leads 1, and 2 leads 4.
  const weekFiveLive = [row(5, 1, '1', 40, 80), row(5, 1, '3', 80, 40), row(5, 2, '2', 60, 20), row(5, 2, '4', 20, 60)]
  function liveInput() {
    const snaps = snapshots(4)
    snaps.push(advanceWeek(snaps[3], 2026, 5, weekFiveLive, IDS, 's5'))
    return {
      season: 2026,
      snapshots: snaps,
      unplayed: UNPLAYED.filter((g) => g.week === 6),
      teams: teams({ '1': { wins: 4 }, '2': { losses: 4 }, '3': { wins: 2, losses: 2 }, '4': { wins: 2, losses: 2 } }),
      rules: RULES,
    }
  }

  it('offers the switch only while a week is being played, and drops the simulated odds on it', () => {
    const final = buildStandingsBoard(liveInput())
    const live = buildStandingsBoard({ ...liveInput(), asIfFinal: true })
    expect(final.pendingWeeks).toEqual([5])

    const { container, unmount } = render(
      <StandingsBoardView board={final} initial={DEFAULT_STANDINGS_VIEW} odds={ODDS} live={live} />,
    )
    const toggle = within(container).getByRole('radiogroup', { name: 'Which results' })
    expect(leagueTable(container).querySelector('.af-stb-odds')).not.toBeNull()
    const youRecord = () => [...leagueTable(container).querySelectorAll('tr[data-you="true"] td')][2].textContent
    expect(youRecord()).toBe('0-4')

    fireEvent.click(within(toggle).getByRole('radio', { name: 'If scores held' }))
    expect(container.querySelector('.af-stb-asif')?.textContent).toMatch(/Week 5 is counted as it stands right now/)
    expect(youRecord()).toBe('1-4')
    expect(leagueTable(container).querySelector('.af-stb-odds')).toBeNull()

    fireEvent.click(within(toggle).getByRole('radio', { name: 'Final results' }))
    expect(youRecord()).toBe('0-4')
    unmount()

    const { container: none } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    expect(within(none).queryByRole('radiogroup', { name: 'Which results' })).toBeNull()
  })
})

describe('StandingsBoardView — your row, kept in reach', () => {
  type Entry = { target: Element; isIntersecting: boolean }
  let fire: (entries: Entry[]) => void = () => {}

  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: Entry[]) => void) {
          fire = cb
        }
        observe() {}
        disconnect() {}
      },
    )
  })

  it('appears when the table is on screen and your row is not, and scrolls back to it', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} odds={ODDS} />)
    const root = container.querySelector('.af-stb')!
    const yourRow = leagueTable(container).querySelector('tr[data-you="true"]') as HTMLElement
    expect(container.querySelector('.af-stb-pinned')).toBeNull()

    act(() => fire([{ target: root, isIntersecting: true }, { target: yourRow, isIntersecting: false }]))
    const bar = container.querySelector('.af-stb-pinned') as HTMLElement
    expect(bar.textContent).toMatch(/Team 2/)
    expect(bar.textContent).toMatch(/0-4/)
    expect(bar.textContent).toMatch(/<1% playoffs|2% playoffs/)

    const scroll = vi.fn()
    yourRow.scrollIntoView = scroll
    fireEvent.click(within(bar).getByRole('button', { name: 'Show my row' }))
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })

    act(() => fire([{ target: yourRow, isIntersecting: true }]))
    expect(container.querySelector('.af-stb-pinned')).toBeNull()
  })

  it('stays hidden once the table itself has scrolled away', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    const root = container.querySelector('.af-stb')!
    const yourRow = leagueTable(container).querySelector('tr[data-you="true"]') as HTMLElement
    act(() => fire([{ target: root, isIntersecting: false }, { target: yourRow, isIntersecting: false }]))
    expect(container.querySelector('.af-stb-pinned')).toBeNull()
  })
})
