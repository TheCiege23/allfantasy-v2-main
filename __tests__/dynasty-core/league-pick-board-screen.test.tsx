/** The "All Teams' Picks" screen on the dynasty tab. */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeaguePickBoard } from '@/components/dynasty/LeaguePickBoard'
import { buildLeaguePickBoard } from '@/lib/dynasty-core/leaguePickBoard'

const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response
afterEach(() => vi.unstubAllGlobals())

describe('LeaguePickBoard', () => {
  it('shows each team’s picks by year, where acquired picks came from, and what was traded away', async () => {
    const board = buildLeaguePickBoard({
      teams: [{ rosterId: 'a', name: 'Aces' }, { rosterId: 'b', name: 'Bears' }],
      picks: [
        { season: 2027, round: 1, ownerRosterId: 'a', originalRosterId: 'a' },
        { season: 2027, round: 1, ownerRosterId: 'a', originalRosterId: 'b' },
      ],
      seasons: [2027],
      rounds: 1,
      coverage: 'complete',
      viewerRosterId: 'b',
    })
    vi.stubGlobal('fetch', vi.fn(async () => json({ board })))
    render(<LeaguePickBoard leagueId="L1" />)
    await screen.findByTestId('league-pick-board')
    expect(screen.getByText('2027')).toBeTruthy()
    expect(screen.getByText('(you)')).toBeTruthy()
    expect(screen.getByText('· Bears')).toBeTruthy()
    expect(screen.getByText('Traded: 1st → Aces')).toBeTruthy()
    expect(screen.getByText('2 firsts')).toBeTruthy()
  })

  it('says so when the league tracks no future picks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ board: null, reason: 'no_picks_tracked' })))
    render(<LeaguePickBoard leagueId="L1" />)
    expect(await screen.findByTestId('pick-board-none')).toBeTruthy()
  })
})
