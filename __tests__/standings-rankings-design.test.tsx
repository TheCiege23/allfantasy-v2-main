import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { Standings } from '@/components/core-app/screens/Standings'
import type { LeagueStandingsResult, StandingRow } from '@/lib/core-app/leagueStandings'
import { advanceWeek, buildStandingsBoard, type WeekSnapshot } from '@/lib/core-app/standingsModel'

/*
 * The per-league Rankings design (2026-09-13), landed on the Standings screen.
 *
 * ⚠ HONESTY RULES, NOT LAYOUT. The handoff drew "win out / lose out" totals that
 * nothing here computes, a caption that contradicted its own bars, and a tile row
 * with no Record tile. Each case pins what the restyle had to keep true.
 */

function team(i: number, over: Partial<StandingRow> = {}): StandingRow {
  return {
    rosterId: String(i),
    name: `Team ${i}`,
    isYou: i === 2,
    rank: i,
    pointsFor: 1500 - i * 50,
    average: 150 - i * 5,
    weeksPlayed: 10,
    wins: 10 - i,
    losses: i,
    movement: 0,
    ...over,
  }
}

/** A real board: four teams, three final weeks, team 2 is you. */
function board() {
  const snaps: WeekSnapshot[] = []
  for (let w = 1; w <= 3; w += 1) {
    const rows = [
      { week: w, rosterId: '1', matchupId: 1, pointsFor: 150, pointsAgainst: 140 + w },
      { week: w, rosterId: '2', matchupId: 1, pointsFor: 140 + w, pointsAgainst: 150 },
      { week: w, rosterId: '3', matchupId: 2, pointsFor: 120, pointsAgainst: 100 },
      { week: w, rosterId: '4', matchupId: 2, pointsFor: 100, pointsAgainst: 120 },
    ]
    snaps.push(advanceWeek(snaps[w - 2] ?? null, 2026, w, rows, ['1', '2', '3', '4'], `s${w}`))
  }
  return buildStandingsBoard({
    season: 2026,
    snapshots: snaps,
    unplayed: [{ week: 4, a: '1', b: '3' }, { week: 4, a: '2', b: '4' }],
    teams: ['1', '2', '3', '4'].map((id) => ({
      rosterId: id,
      name: `Team ${id}`,
      avatarUrl: null,
      isYou: id === '2',
      division: null,
      reported: null,
    })),
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

function standings(over: Record<string, unknown> = {}): LeagueStandingsResult {
  const teams = [1, 2, 3, 4].map((i) => team(i))
  return {
    available: true,
    league: { id: 'l1', name: 'Last League Left', platform: 'sleeper' },
    season: 2026,
    week: 11,
    seasonComplete: false,
    teams,
    you: teams[1],
    trend: [
      { week: 9, rank: 4, pointsFor: 1000 },
      { week: 10, rank: 1, pointsFor: 1150 },
      { week: 11, rank: 2, pointsFor: 1300 },
    ],
    recent: [{ week: 10, pointsFor: 142.6, delta: 1.3, rank: 2 }],
    projection: {
      available: true,
      data: { mid: 1978, low: 1953, high: 2005, weeksRemaining: 4, basis: 'Pace across the weeks left.' },
    },
    scoredWeeks: 10,
    history: [],
    board: board(),
    ...over,
  } as unknown as LeagueStandingsResult
}

describe('Standings — the per-league Rankings design', () => {
  it('labels the projection rows as a range, never as record scenarios', () => {
    render(<Standings data={standings()} />)
    expect(screen.getByText('Top of the projected range')).toBeTruthy()
    expect(screen.getByText('Bottom of the projected range')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/win out|lose out/i)
  })

  it('gives the record its own tile whether or not there is a projection', () => {
    const { unmount } = render(<Standings data={standings()} />)
    expect(screen.getByText('Record', { selector: '.af-st-tile .af-label' })).toBeTruthy()
    unmount()
    render(<Standings data={standings({ projection: { available: false, reason: 'Too few weeks scored.' } })} />)
    expect(screen.getByText('Record', { selector: '.af-st-tile .af-label' })).toBeTruthy()
    expect(screen.getByText('Too few weeks scored.')).toBeTruthy()
  })

  it('tags the projected points as a model', () => {
    const { container } = render(<Standings data={standings()} />)
    expect(container.querySelector('.af-st-projection .af-stb-projtag')?.textContent).toBe('Model')
  })

  /* The handoff's caption said "lower bar = better"; its drawing said the opposite. */
  it('draws a better rank as a taller bar, and says so', () => {
    const { container } = render(<Standings data={standings()} />)
    const heights = [...container.querySelectorAll<HTMLElement>('.af-st-bar-fill')].map((el) =>
      parseFloat(el.style.height),
    )
    // Weeks 9, 10, 11 ranked 4th, 1st, 2nd.
    expect(heights[1]).toBeGreaterThan(heights[2])
    expect(heights[2]).toBeGreaterThan(heights[0])
    expect(screen.getByText(/Taller bar = better rank/)).toBeTruthy()
  })

  it('says whose average a recent week is measured against', () => {
    render(<Standings data={standings()} />)
    expect(screen.getByText('+1.3 vs your avg')).toBeTruthy()
  })
})
