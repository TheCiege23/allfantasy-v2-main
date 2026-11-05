/**
 * Live scores · the held league's OTHER games this week: read from the stored league scoreboard
 * (never a provider), the viewer's own game left out, and every row honest about live / final /
 * projected.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))

const scoreboard = vi.fn()
vi.mock('@/lib/core-app/leagueScoreboard', () => ({ getLeagueScoreboard: (args: unknown) => scoreboard(args) }))
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: async () => ({ season: '2026', week: 9 }) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: async () => ({ id: 'lg', platformLeagueId: 'p-lg', settings: {} }) },
    leagueTeam: { findFirst: async () => ({ externalId: '3' }) },
  },
}))

import { getLiveLeagueGames, otherGames } from '@/lib/core-app/liveLeagueScoreboard'
import { LiveLeagueGames, liveGameState } from '@/components/core-app/screens/LiveLeagueGames'
import type { ScoreboardGame, ScoreboardTeam } from '@/lib/core-app/leagueScoreboard'

afterEach(() => {
  cleanup()
  scoreboard.mockReset()
})

function team(rosterId: string, name: string, points: number | null, projected: number | null, isYou = false): ScoreboardTeam {
  return { rosterId, teamName: name, managerName: null, avatarUrl: null, points, projected, projectedFrom: 9, starterCount: 9, isYou }
}
function game(id: number, a: ScoreboardTeam, b: ScoreboardTeam, unplayed = false): ScoreboardGame {
  return { matchupId: id, teams: [a, b], winProbability: null, unplayed, margin: null }
}

const mine = game(1, team('3', 'Fourth & Forever', 84.6, 120, true), team('7', 'Gridiron Ghosts', 71.2, 110))
const theirs = game(2, team('1', 'Taco Tuesday', 102.4, 118), team('2', 'Hurts Donut', 96.1, 121))
const later = game(3, team('4', 'Bijan Mustard', null, 115.3), team('5', 'The Waiver Wire', null, 109.8), true)

describe('the stored scoreboard, minus your own game', () => {
  it('asks for the week your matchup is in, and leaves your game out', async () => {
    scoreboard.mockResolvedValue({ seasonYear: 2026, week: 9, games: [mine, theirs, later], allUnplayed: false, unpaired: [], projectionBasis: null })
    const out = await getLiveLeagueGames({ leagueId: 'lg', userId: 'u', seasonYear: 2026, week: 9 })
    expect(scoreboard).toHaveBeenCalledWith(expect.objectContaining({ platformLeagueId: 'p-lg', seasonYear: 2026, week: 9, yourRosterId: '3' }))
    expect(out?.games.map((g) => g.matchupId)).toEqual([2, 3])
  })

  it('is null when the board cannot be read, so the section stays away', async () => {
    scoreboard.mockResolvedValue(null)
    expect(await getLiveLeagueGames({ leagueId: 'lg', userId: 'u', seasonYear: 2026, week: 9 })).toBeNull()
  })

  it('drops a half-paired game', () => {
    expect(otherGames([{ ...theirs, teams: [theirs.teams[0]] }])).toEqual([])
  })
})

describe('the rows', () => {
  it('a scored game is LIVE in an open week and FINAL once the week closes; an unscored one is UPCOMING', () => {
    expect(liveGameState(theirs, false)).toBe('live')
    expect(liveGameState(theirs, true)).toBe('final')
    expect(liveGameState(later, false)).toBe('upcoming')
  })

  it('shows both teams, the score or a marked projection, and the chip', () => {
    render(<LiveLeagueGames leagueId="lg" data={{ week: 9, allUnplayed: false, weekFinal: false, games: [theirs, later] }} />)
    const rows = screen.getAllByTestId('live-league-game')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Taco Tuesday')
    expect(rows[0].textContent).toContain('102.4')
    expect(rows[0].textContent).toContain('Live')
    expect(rows[1].textContent).toContain('115.3 proj')
    expect(rows[1].textContent).toContain('Upcoming')
  })

  it('renders nothing when there are no other games', () => {
    const { container } = render(<LiveLeagueGames leagueId="lg" data={{ week: 9, allUnplayed: false, weekFinal: false, games: [] }} />)
    expect(container.innerHTML).toBe('')
  })
})
