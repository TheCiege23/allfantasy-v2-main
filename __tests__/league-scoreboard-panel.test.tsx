import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { LeagueScoreboardPanel } from '@/components/core-app/screens/LeagueScoreboardPanel'
import type { LeagueScoreboard, ScoreboardTeam } from '@/lib/core-app/leagueScoreboard'

function team(over: Partial<ScoreboardTeam> = {}): ScoreboardTeam {
  return {
    rosterId: 1,
    teamName: 'Yours',
    managerName: 'chxnk',
    avatarUrl: null,
    points: null,
    projected: null,
    projectedFrom: 9,
    starterCount: 9,
    isYou: false,
    ...over,
  }
}

function board(over: Partial<LeagueScoreboard> = {}): LeagueScoreboard {
  return {
    seasonYear: 2026,
    week: 1,
    allUnplayed: false,
    unpaired: [],
    games: [
      {
        matchupId: 1,
        unplayed: false,
        margin: 16.8,
        teams: [
          team({ rosterId: 1, teamName: 'Yours', points: 118.2, isYou: true }),
          team({ rosterId: 2, teamName: 'DynastyDan', points: 101.4 }),
        ],
      },
      {
        matchupId: 2,
        unplayed: false,
        margin: 37.7,
        teams: [
          team({ rosterId: 3, teamName: 'Third', points: 96.0 }),
          team({ rosterId: 4, teamName: 'Fourth', points: 133.7 }),
        ],
      },
    ],
    ...over,
  }
}

const text = (b: LeagueScoreboard) =>
  (render(<LeagueScoreboardPanel board={b} />).container.textContent ?? '').replace(/\s+/g, ' ')

describe('LeagueScoreboardPanel', () => {
  it('⚠ shows every game, not only the viewer&apos;s', () => {
    const t = text(board())
    expect(t).toContain('Yours')
    expect(t).toContain('DynastyDan')
    expect(t).toContain('Third')
    expect(t).toContain('Fourth')
    expect(t).toContain('2 games')
  })

  it('marks the viewer&apos;s own game', () => {
    const c = render(<LeagueScoreboardPanel board={board()} />).container
    expect(c.querySelector('.af-sb-game[data-yours="true"]')).toBeTruthy()
  })

  it('⚠ flags LOUDLY that an unplayed week is all projections', () => {
    /*
     * A projected board that reads like a live one invites someone to
     * celebrate or panic over a game nobody has played. One flag at the top,
     * not a footnote per row.
     */
    const t = text(
      board({
        allUnplayed: true,
        games: [
          {
            matchupId: 1,
            unplayed: true,
            margin: null,
            teams: [
              team({ rosterId: 1, projected: 118.2, isYou: true }),
              team({ rosterId: 2, teamName: 'DynastyDan', projected: 101.4 }),
            ],
          },
        ],
      }),
    )
    expect(t).toContain('Nothing scored yet')
    expect(t).toContain('projections')
  })

  it('sets a projection back from a result so the two never read alike', () => {
    const c = render(
      <LeagueScoreboardPanel
        board={board({
          allUnplayed: true,
          games: [
            {
              matchupId: 1,
              unplayed: true,
              margin: null,
              teams: [team({ projected: 118.2 }), team({ rosterId: 2, projected: 101.4 })],
            },
          ],
        })}
      />,
    ).container
    expect(c.querySelector('.af-sb-pts[data-projected="true"]')).toBeTruthy()
  })

  it('shows coverage next to a partially priced lineup', () => {
    const t = text(
      board({
        allUnplayed: true,
        games: [
          {
            matchupId: 1,
            unplayed: true,
            margin: null,
            teams: [
              team({ projected: 80, projectedFrom: 5, starterCount: 9 }),
              team({ rosterId: 2, projected: 101.4 }),
            ],
          },
        ],
      }),
    )
    expect(t).toContain('5/9')
  })

  it('prints an em dash rather than a zero for a team it cannot price', () => {
    // Zero would claim the lineup is worth nothing. It means we could not
    // price it, which is a different sentence.
    const t = text(
      board({
        allUnplayed: true,
        games: [
          {
            matchupId: 1,
            unplayed: true,
            margin: null,
            teams: [team({ projected: null }), team({ rosterId: 2, projected: null })],
          },
        ],
      }),
    )
    expect(t).toContain('—')
    expect(t).not.toMatch(/\b0\.0\b/)
  })

  it('keeps unpaired teams visible instead of losing half the league', () => {
    const t = text(
      board({
        games: [],
        unpaired: [team({ rosterId: 5, teamName: 'Fifth' }), team({ rosterId: 6, teamName: 'Sixth' })],
      }),
    )
    expect(t).toContain('Not paired into a game yet')
    expect(t).toContain('Fifth')
    expect(t).toContain('Sixth')
  })

  it('says "level" rather than "by 0.0" on a tie', () => {
    const t = text(
      board({
        games: [
          {
            matchupId: 1,
            unplayed: false,
            margin: 0,
            teams: [team({ points: 100 }), team({ rosterId: 2, points: 100 })],
          },
        ],
      }),
    )
    expect(t).toContain('level')
  })

  it('falls back to the roster id rather than rendering a blank name', () => {
    const t = text(
      board({
        games: [
          {
            matchupId: 1,
            unplayed: false,
            margin: null,
            teams: [
              team({ rosterId: 9, teamName: null, managerName: null, points: 100 }),
              team({ rosterId: 2, points: 90 }),
            ],
          },
        ],
      }),
    )
    expect(t).toContain('Roster 9')
  })
})
