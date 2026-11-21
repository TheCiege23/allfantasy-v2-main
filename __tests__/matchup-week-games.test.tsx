import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))

import Matchup from '@/components/core-app/screens/Matchup'
import { teamGamesInWeek, weekGameLines, type MatchupData } from '@/lib/core-app/matchup'

/*
 * A league whose teams play several games a week (Fantrax: 3 or 5). The matchup screen showed one of
 * them; it now lists every game, opens the first, and any other on a tap (`?game=`).
 */

beforeEach(() => {
  ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class { observe() {} disconnect() {} }
})
afterEach(() => {
  cleanup()
  delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver
})

const row = (rosterId: string, matchupId: number, game: number, pointsFor: number, pointsAgainst: number) => ({ rosterId, matchupId, game, pointsFor, pointsAgainst })
const names: Record<string, string> = { b: 'Bravo', c: 'Charlie', d: 'Delta' }
// Team a plays three games: beats b, loses to c, and has not played d yet.
const week = [
  row('a', 3, 3, 0, 0), row('d', 3, 1, 0, 0),
  row('a', 1, 1, 110, 90), row('b', 1, 1, 90, 110),
  row('c', 2, 1, 120, 95), row('a', 2, 2, 95, 120),
]

describe('a team\'s games in one week', () => {
  it('lists every game in game order with its opponent, score and result', () => {
    const mine = teamGamesInWeek(week, 'a')
    expect(mine.map((r) => r.game)).toEqual([1, 2, 3])
    expect(weekGameLines(week, mine, mine[1]!, (id) => names[id] ?? null)).toEqual([
      { game: 1, opponentName: 'Bravo', yourPoints: 110, opponentPoints: 90, result: 'win', selected: false },
      { game: 2, opponentName: 'Charlie', yourPoints: 95, opponentPoints: 120, result: 'loss', selected: true },
      { game: 3, opponentName: 'Delta', yourPoints: 0, opponentPoints: 0, result: null, selected: false },
    ])
  })

  it('is nothing to list in a league that plays one game a week', () => {
    const oneGame = [row('a', 1, 1, 100, 99), row('b', 1, 1, 99, 100)]
    const mine = teamGamesInWeek(oneGame, 'a')
    expect(mine).toHaveLength(1)
    expect(weekGameLines(oneGame, mine, mine[0]!, () => null)).toBeNull()
  })

  it('treats rows stored before games were numbered as game 1', () => {
    const legacy = [{ rosterId: 'a', matchupId: 1, pointsFor: 5, pointsAgainst: 4 }]
    expect(teamGamesInWeek(legacy, 'a')).toHaveLength(1)
  })
})

function data(weekGames?: MatchupData['weekGames'], isFinal = false): MatchupData {
  return {
    league: { id: 'l1', name: 'Test League', platform: 'fantrax', logoUrl: null, sourceLink: null, lineupLink: null },
    week: { available: true, data: { week: 4, season: 2026, isFinal } },
    teams: {
      available: true,
      data: {
        you: { teamName: 'Mine', ownerName: 'me', record: '2-1', isYou: true, avatarUrl: null },
        opponent: { teamName: 'Bravo', ownerName: 'them', record: '2-1', isYou: false, avatarUrl: null },
      },
    },
    sides: { available: false, reason: 'not scored yet' },
    lineups: { available: false, reason: 'n/a' },
    identityNote: null,
    playerScoring: { available: false, reason: 'projections' },
    winProbability: { available: false, reason: 'n/a' } as MatchupData['winProbability'],
    projectedFinal: { available: false, reason: 'n/a' } as MatchupData['projectedFinal'],
    yetToPlay: { available: false, reason: 'tally' },
    starterCountsBySide: null,
    ...(weekGames ? { weekGames } : {}),
  }
}

describe('the matchup screen', () => {
  it('shows every game of a multi-game week, each a link to open it, the open one marked', () => {
    const mine = teamGamesInWeek(week, 'a')
    render(<Matchup data={data(weekGameLines(week, mine, mine[0]!, (id) => names[id] ?? null))} />)
    const list = screen.getByTestId('matchup-week-games')
    expect(list).toHaveTextContent("This week's games (3)")
    const first = screen.getByTestId('matchup-week-game-1')
    expect(first).toHaveTextContent('Game 1 · vs Bravo')
    // The week is still being played: a standing, not a result.
    expect(first).toHaveTextContent('110.00 – 90.00 · Ahead')
    expect(first).not.toHaveTextContent('Win')
    expect(first).toHaveAttribute('aria-current', 'true')
    const second = screen.getByTestId('matchup-week-game-2')
    expect(second).toHaveTextContent('95.00 – 120.00 · Behind')
    expect(second).not.toHaveTextContent('Loss')
    expect(second).toHaveAttribute('href', '/core/matchup?league=l1&week=4&game=2')
    expect(second).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('matchup-week-game-3')).toHaveTextContent('Not scored yet')
  })

  /** Production 2026-11-21: "0.00 – 25.40 · Loss" on a Saturday, with two days of games left. */
  it('names a win or a loss only once the week is final', () => {
    const mine = teamGamesInWeek(week, 'a')
    render(<Matchup data={data(weekGameLines(week, mine, mine[0]!, (id) => names[id] ?? null), true)} />)
    expect(screen.getByTestId('matchup-week-game-1')).toHaveTextContent('110.00 – 90.00 · Win')
    expect(screen.getByTestId('matchup-week-game-2')).toHaveTextContent('95.00 – 120.00 · Loss')
  })

  it('shows no list in a league that plays one game a week', () => {
    render(<Matchup data={data()} />)
    expect(screen.queryByTestId('matchup-week-games')).toBeNull()
  })
})
