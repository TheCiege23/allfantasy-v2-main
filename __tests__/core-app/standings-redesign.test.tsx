import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { StandingsBoardView } from '@/components/core-app/standings/StandingsBoardView'
import {
  advanceWeek,
  buildStandingsBoard,
  type StandingsRules,
  type WeekRow,
  type WeekSnapshot,
} from '@/lib/core-app/standingsModel'
import { DEFAULT_STANDINGS_VIEW, parseStandingsView } from '@/lib/core-app/standingsView'

/*
 * The 2026-11 Standings redesign: a Diff and an AF Power column in the league table, and the playoff
 * picture — the field if the season ended today plus the race for the last spot. Everything is read off
 * the board; no pairing is drawn, because the bracket format is the league's and /core does not have it.
 */

afterEach(cleanup)

const RULES: StandingsRules = {
  playoffTeams: 4,
  playoffTeamsSource: 'league',
  byes: 2,
  regularSeasonEnd: null,
  tiebreakers: ['points_for'],
  tiebreakerSource: 'platform',
  rankIsOfficial: false,
  platformLabel: 'Sleeper',
}

const IDS = ['1', '2', '3', '4', '5', '6']

function row(week: number, m: number, id: string, pf: number, pa: number): WeekRow {
  return { week, rosterId: id, matchupId: m, pointsFor: pf, pointsAgainst: pa }
}

/* 1 beats everyone, 6 loses to everyone; the middle splits so the line has a race at it. */
function snapshots(): WeekSnapshot[] {
  const out: WeekSnapshot[] = []
  const weeks: Array<Array<[string, number, string, number]>> = [
    [['1', 140, '6', 90], ['2', 130, '5', 100], ['3', 120, '4', 110]],
    [['1', 135, '5', 95], ['2', 125, '4', 105], ['3', 100, '6', 115]],
    [['1', 150, '4', 100], ['3', 128, '2', 118], ['5', 112, '6', 96]],
  ]
  weeks.forEach((games, i) => {
    const w = i + 1
    const rows = games.flatMap(([a, pa, b, pb], m) => [row(w, m + 1, a, pa, pb), row(w, m + 1, b, pb, pa)])
    out.push(advanceWeek(out[i - 1] ?? null, 2026, w, rows, IDS, `s${w}`))
  })
  return out
}

function board() {
  return buildStandingsBoard({
    season: 2026,
    snapshots: snapshots(),
    unplayed: [
      { week: 4, a: '1', b: '2' },
      { week: 4, a: '3', b: '5' },
      { week: 4, a: '4', b: '6' },
    ],
    teams: IDS.map((id) => ({ rosterId: id, name: `Team ${id}`, avatarUrl: null, isYou: id === '4', division: null, reported: null })),
    rules: RULES,
  })
}

describe('Standings — the league table’s new columns', () => {
  it('prints PF minus PA, signed, and the AF Power rank on every row', () => {
    const b = board()
    const { container } = render(<StandingsBoardView board={b} initial={DEFAULT_STANDINGS_VIEW} />)
    const table = container.querySelector('table.af-stb-table') as HTMLElement
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toContain('Diff')
    expect(heads).toContain('AF')
    const top = b.teams.find((t) => t.rosterId === '1')!
    const diff = top.pointsFor - (top.pointsAgainst ?? 0)
    const cell = table.querySelector('tbody tr:first-child .af-stb-diff')
    expect(cell?.textContent).toBe(`+${diff.toFixed(1)}`)
    expect(cell?.getAttribute('data-tone')).toBe('good')
    expect(table.querySelectorAll('tbody tr:not(.af-stb-line) .af-stb-afrank')).toHaveLength(IDS.length)
  })
})

describe('Standings — the playoff picture', () => {
  it('is a view in the URL', () => {
    expect(parseStandingsView((k) => ({ st_view: 'playoffs' })[k as 'st_view']).view).toBe('playoffs')
  })

  it('shows the field as byes and first-round teams, and no pairings', () => {
    const b = board()
    const { container } = render(<StandingsBoardView board={b} initial={DEFAULT_STANDINGS_VIEW} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Playoff picture' }))
    const pic = screen.getByTestId('standings-playoff-picture')
    const bySeed = [...b.teams].sort((x, y) => x.seed - y.seed)
    const cols = pic.querySelectorAll('.af-stb-fieldcol')
    expect(cols).toHaveLength(2)
    expect([...cols[0].querySelectorAll('.af-stb-seedname')].map((e) => e.textContent)).toEqual(bySeed.slice(0, 2).map((t) => t.name))
    expect([...cols[1].querySelectorAll('.af-stb-seedname')].map((e) => e.textContent?.replace('You', ''))).toEqual(
      bySeed.slice(2, 4).map((t) => t.name),
    )
    expect(pic.textContent).toContain('pairings are the league’s to set')
    // The table is not drawn under it.
    expect(container.querySelector('.af-stb-scroll[aria-label="League table"]')).toBeNull()
  })

  it('races the last seed in against the teams just below the line', () => {
    const b = board()
    render(<StandingsBoardView board={b} initial={{ ...DEFAULT_STANDINGS_VIEW, view: 'playoffs' }} />)
    const race = screen.getByTestId('standings-race')
    const bySeed = [...b.teams].sort((x, y) => x.seed - y.seed)
    const holding = race.querySelector('.af-stb-racerow[data-role="holding"] .af-stb-racename')
    expect(holding?.textContent).toContain(bySeed[3].name)
    const chasing = [...race.querySelectorAll('.af-stb-racerow[data-role="chasing"]')]
    const expected = bySeed.slice(4).filter((t) => t.zone !== 'eliminated')
    expect(chasing).toHaveLength(expected.length)
  })

  it('is not offered to a league where every team makes the field', () => {
    const b = buildStandingsBoard({
      season: 2026,
      snapshots: snapshots(),
      unplayed: [],
      teams: IDS.map((id) => ({ rosterId: id, name: `Team ${id}`, avatarUrl: null, isYou: false, division: null, reported: null })),
      rules: { ...RULES, playoffTeams: 6 },
    })
    const { container } = render(<StandingsBoardView board={b} initial={{ ...DEFAULT_STANDINGS_VIEW, view: 'playoffs' }} />)
    expect(screen.queryByRole('radio', { name: 'Playoff picture' })).toBeNull()
    // A URL asking for it falls back to the league table, not the power table.
    expect(screen.getByRole('radio', { name: 'League table' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByTestId('standings-playoff-picture')).toBeNull()
    const table = container.querySelector('table.af-stb-table')
    expect(table).not.toBeNull()
    expect(table?.getAttribute('data-view')).not.toBe('power')
  })
})
