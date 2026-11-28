import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PlayerWindowRanks from '@/components/player-game-log/PlayerWindowRanks'

const w = (key: string, label: string, rank: number | null, positionRank: number | null, games: number, perGame: number | null) => ({
  key, label, rank, positionRank, games, perGame, points: perGame != null ? perGame * games : null, population: 700,
})
const payload = {
  supported: true,
  resolved: true,
  scoring: { kind: 'league', leagueName: 'Sunday Night Redraft' },
  ranks: {
    position: 'C',
    windows: [w('d7', 'Last 7', 12, 5, 4, 4.55), w('d14', 'Last 14', 30, 11, 7, 3.9), w('d30', 'Last 30', 25, 9, 14, 3.71), w('season', 'Season', null, null, 0, null)],
  },
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PlayerWindowRanks', () => {
  it('shows each window: overall rank, position rank, points per game and games, on the league’s scoring', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<PlayerWindowRanks sport="NHL" playerKey={{ externalId: '9', source: 'rolling_insights' }} scoringContext={{ leagueId: 'lg1', position: 'C' }} />)
    const d7 = await screen.findByTestId('af-window-rank-d7')
    expect(d7.textContent).toContain('Last 7')
    expect(d7.textContent).toContain('#12')
    expect(d7.textContent).toContain('C #5')
    expect(d7.textContent).toContain('4.6/g · 4 GP')
    expect(screen.getByTestId('af-window-rank-season').textContent).toContain('no games')
    expect(screen.getByTestId('af-window-ranks').textContent).toContain('Sunday Night Redraft scoring')
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/players/window-ranks?')
    expect(url).toContain('externalId=9')
    expect(url).toContain('leagueId=lg1')
  })

  it('no ranked window, no strip', async () => {
    const empty = { ...payload, ranks: { position: 'C', windows: payload.ranks.windows.map((x) => ({ ...x, rank: null, games: 0 })) } }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(empty), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<PlayerWindowRanks sport="NHL" playerKey={{ identityId: 'p1' }} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByTestId('af-window-ranks')).toBeNull()
  })
})
