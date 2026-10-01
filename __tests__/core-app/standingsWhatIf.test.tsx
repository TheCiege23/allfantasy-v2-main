import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { advanceWeek, buildStandingsBoard, type WeekRow, type WeekSnapshot } from '@/lib/core-app/standingsModel'
import { applyWhatIf, gameKey, whatIfSetup } from '@/lib/core-app/standingsWhatIf'
import { StandingsWhatIf } from '@/components/core-app/standings/StandingsWhatIf'

/*
 * Four teams, four final weeks: 1 is 4-0, 3 and 4 are level at 2-2 on identical points (3 ahead on
 * name), and 2 — you — is 0-4. Week 5 pairs 1 v 3 and 2 v 4; top 2 make it.
 */
const IDS = ['1', '2', '3', '4']

function row(week: number, m: number, id: string, pf: number, pa: number): WeekRow {
  return { week, rosterId: id, matchupId: m, pointsFor: pf, pointsAgainst: pa }
}

function board() {
  const snaps: WeekSnapshot[] = []
  for (let w = 1; w <= 4; w += 1) {
    const rows = [
      row(w, 1, '1', 150, 120 + w),
      row(w, 1, '2', 120 + w, 150),
      row(w, 2, '3', w % 2 ? 110 : 100, w % 2 ? 100 : 110),
      row(w, 2, '4', w % 2 ? 100 : 110, w % 2 ? 110 : 100),
    ]
    snaps.push(advanceWeek(snaps[w - 2] ?? null, 2026, w, rows, IDS, `s${w}`))
  }
  return buildStandingsBoard({
    season: 2026,
    snapshots: snaps,
    unplayed: [
      { week: 5, a: '1', b: '3' },
      { week: 5, a: '2', b: '4' },
      { week: 6, a: '1', b: '4' },
      { week: 6, a: '2', b: '3' },
    ],
    teams: IDS.map((id) => ({ rosterId: id, name: `Team ${id}`, avatarUrl: null, isYou: id === '2', division: null, reported: null })),
    rules: {
      playoffTeams: 2,
      playoffTeamsSource: 'league',
      byes: 0,
      regularSeasonEnd: null,
      tiebreakers: ['points_for', 'head_to_head'],
      tiebreakerSource: 'platform',
      rankIsOfficial: false,
      platformLabel: 'Sleeper',
    },
  })
}

afterEach(cleanup)

describe('board.nextGames', () => {
  it('carries only the earliest undecided week, each pairing once', () => {
    expect(board().nextGames).toEqual({ week: 5, games: [{ a: '1', b: '3' }, { a: '2', b: '4' }] })
  })
})

describe('applyWhatIf', () => {
  it('puts your game first', () => {
    const setup = whatIfSetup(board())!
    expect(setup.games[0].key).toBe(gameKey('2', '4'))
  })

  it('reproduces the live table with no picks', () => {
    const b = board()
    const rows = applyWhatIf(b, whatIfSetup(b)!, {})
    expect(rows.map((r) => r.team.rosterId)).toEqual(b.teams.map((t) => t.rosterId))
    expect(rows.every((r) => r.move === 0)).toBe(true)
  })

  it('adds the picked results and re-sorts by the table’s own rule', () => {
    const b = board()
    const rows = applyWhatIf(b, whatIfSetup(b)!, { [gameKey('1', '3')]: '1', [gameKey('2', '4')]: '4' })
    expect(rows.map((r) => [r.team.name, `${r.record.wins}-${r.record.losses}`, r.move])).toEqual([
      ['Team 1', '5-0', 0],
      ['Team 4', '3-2', 1],
      ['Team 3', '2-3', -1],
      ['Team 2', '0-5', 0],
    ])
    expect(rows.find((r) => r.team.rosterId === '4')!.inField).toBe(true)
  })

  /* A pick cannot supply the score a median game is decided by, and a points league has nothing to pick. */
  it('is not offered for a median-game or points-only league', () => {
    expect(whatIfSetup({ ...board(), medianGames: true })).toBeNull()
    expect(whatIfSetup({ ...board(), hasHeadToHead: false })).toBeNull()
    expect(whatIfSetup({ ...board(), nextGames: undefined })).toBeNull()
  })
})

describe('StandingsWhatIf', () => {
  it('re-sorts on a tap, tells you where you land, and clears', () => {
    const { container } = render(<StandingsWhatIf board={board()} />)
    expect(screen.getByText(/Today you are 4th/)).toBeTruthy()

    const team4 = screen.getByRole('button', { name: /Team 4/ })
    fireEvent.click(team4)
    expect(team4.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('You would stay 4th — outside the playoffs.')).toBeTruthy()
    const names = [...container.querySelectorAll('.af-st-whatif-table .af-st-whatif-name')].map((n) => n.textContent)
    expect(names.indexOf('Team 4')).toBeLessThan(names.indexOf('Team 3'))

    // Tapping the picked side again un-picks it.
    fireEvent.click(team4)
    expect(team4.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'I win' }))
    expect(screen.getByRole('button', { name: /Team 2/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText(/Today you are 4th/)).toBeTruthy()
  })

  it('draws nothing where it cannot be honest', () => {
    const { container } = render(<StandingsWhatIf board={{ ...board(), medianGames: true }} />)
    expect(container.innerHTML).toBe('')
  })
})
