import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import PlayerGameLogTable from '@/components/player-game-log/PlayerGameLogTable'
import { gameLogColumns } from '@/lib/player-game-log/gameLogColumns'

const skaterCols = gameLogColumns('NHL', 'skaters')

function game(i: number, over: Record<string, unknown> = {}) {
  return {
    gameId: `g${i}:skaters`,
    date: `2026-11-${String(26 - i).padStart(2, '0')}`,
    opponent: 'DAL',
    home: i % 2 === 0,
    teamScore: 4,
    oppScore: 2,
    result: 'W',
    postseason: false,
    played: true,
    values: { toi: 18.5, g: 1, a: 1, pts: 2, plusminus: 1, sog: 3, ppp: 0, shp: 0, hits: 2, blks: 1, pim: 0, fow: 0 },
    ratioInputs: {},
    ...over,
  }
}

const payload = {
  supported: true,
  resolved: true,
  season: 2026,
  seasons: [2026, 2025],
  groups: [{ group: 'skaters', label: 'Skater', columns: skaterCols, rows: Array.from({ length: 12 }, (_, i) => game(i)) }],
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PlayerGameLogTable', () => {
  it('shows the final score, TOI as the first stat, and recent-form averages', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<PlayerGameLogTable sport="NHL" playerKey={{ identityId: 'p1' }} />)

    const table = await screen.findByRole('table')
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers[1]).toBe('TOI')
    expect(screen.getAllByText(/4-2/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Last 5/)).toBeTruthy()
    expect(screen.getByText(/Last 10/)).toBeTruthy()
    expect(screen.getAllByText('18:30').length).toBeGreaterThan(0)
    expect(String(fetchMock.mock.calls[0][0])).toContain('identityId=p1')
  })

  it('compact mode hides secondary columns until expanded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))
    render(<PlayerGameLogTable sport="NHL" compact playerKey={{ externalId: '123', source: 'rolling_insights' }} />)
    const table = await screen.findByRole('table')
    expect(within(table).queryByText('FOW')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Show all 12 games/ }))
    await waitFor(() => expect(within(screen.getByRole('table')).getByText('FOW')).toBeTruthy())
  })

  it('says so when the player is not linked, instead of an empty table', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ supported: true, resolved: false, season: null, seasons: [], groups: [] }), { status: 200 })))
    render(<PlayerGameLogTable sport="NHL" playerKey={{ identityId: 'x' }} />)
    expect(await screen.findByText(/not linked this player/)).toBeTruthy()
  })
})

describe('PlayerGameLogTable — fantasy points per game', () => {
  const pts = [3.2, 2.9, 5.5, 12.1, 3.0, 0, 3.1, 2.8, 3.3, 2.7, 3.0, 3.2]
  const scored = {
    ...payload,
    scoring: { kind: 'league', leagueName: 'Sunday Night Redraft' },
    groups: [{ ...payload.groups[0], rows: payload.groups[0].rows.map((r, i) => ({ ...r, fantasyPoints: pts[i] })) }],
  }

  it('puts FPts right after the game, says whose scoring it is, and averages it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(scored), { status: 200 })))
    render(<PlayerGameLogTable sport="NHL" playerKey={{ identityId: 'p1' }} />)
    const table = await screen.findByRole('table')
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers[1]).toBe('FPts')
    expect(headers[2]).toBe('TOI')
    expect(screen.getByTestId('af-game-log-scoring').textContent).toContain('Sunday Night Redraft scoring')
    // Season average of the twelve games.
    const avg = Math.round((pts.reduce((a, b) => a + b, 0) / pts.length) * 10) / 10
    const season = within(table).getByText(/Season/).closest('tr')!
    expect(within(season).getAllByRole('cell')[0].textContent).toBe(String(avg))
  })

  it('marks only the games far from his own average, in words as well as arrows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(scored), { status: 200 })))
    const { container } = render(<PlayerGameLogTable sport="NHL" playerKey={{ identityId: 'p1' }} />)
    await screen.findByRole('table')
    const high = container.querySelectorAll('td.af-gl-fpts[data-mark="high"]')
    const low = container.querySelectorAll('td.af-gl-fpts[data-mark="low"]')
    // 5.5 is a good night (about 1.5x his average) but not an unusual one: unmarked.
    expect(high).toHaveLength(1)
    expect(high[0].textContent).toContain('12.1')
    expect(high[0].textContent).toContain('well above his average')
    expect(low).toHaveLength(1)
    expect(low[0].textContent).toContain('well below his average')
  })

  it("asks for the league's scoring and the player's position", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(scored), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<PlayerGameLogTable sport="NHL" playerKey={{ identityId: 'p1' }} scoringContext={{ leagueId: 'lg1', position: 'C' }} />)
    await screen.findByRole('table')
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('leagueId=lg1')
    expect(url).toContain('position=C')
  })

  it('no points in the payload, no FPts column', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))
    render(<PlayerGameLogTable sport="NHL" playerKey={{ identityId: 'p1' }} />)
    const table = await screen.findByRole('table')
    expect(within(table).queryByText('FPts')).toBeNull()
    expect(screen.queryByTestId('af-game-log-scoring')).toBeNull()
  })
})
