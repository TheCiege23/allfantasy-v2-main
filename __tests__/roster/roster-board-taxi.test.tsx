/**
 * The roster board's quick "Taxi" move (phase 8, 2026-10-29), and the board putting a refused move back
 * the way the server has it. Rendered against the real hook (`useRosterManager`) with `fetch` stubbed.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useUserTimezone', () => ({ useUserTimezone: () => ({ formatTimeInTimezone: () => '' }) }))
vi.mock('@/components/player-card/PlayerCardAnalytics', () => ({ default: () => null }))

import RosterBoard from '@/components/app/roster/RosterBoard'

const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response
const row = (id: string, position: string, slotIndex?: number) => ({ id, name: `Player ${id}`, position, team: 'DAL', ...(slotIndex != null ? { slotIndex } : {}) })
const rosterBody = (taxi: number) => ({
  rosterId: 'r1',
  sport: 'NFL',
  canEditLineup: true,
  roster: { lineup_sections: { starters: [row('qb1', 'QB', 0)], bench: [row('rk1', 'WR')], ir: [], taxi: [], devy: [] } },
  slotLimits: { starters: 1, bench: 5, ir: 1, taxi },
})

function stub(taxi: number, saveOk: boolean) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('/api/league/roster')) return json(rosterBody(taxi))
    if (String(url) === '/api/leagues/roster/save') return saveOk ? json({ ok: true }) : json({ error: 'Player rk1 can’t go onto the taxi squad: it locked after week 6.' }, false)
    return json({ players: [] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('the Taxi quick move', () => {
  it('moves a bench player to the taxi squad and saves it', async () => {
    const fetchMock = stub(3, true)
    render(<RosterBoard leagueId="L1" />)
    fireEvent.click(await screen.findByTestId('roster-move-taxi-rk1'))
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/api/leagues/roster/save')).toBe(true))
    const save = fetchMock.mock.calls.find((c) => c[0] === '/api/leagues/roster/save')!
    const body = JSON.parse(String(save[1]!.body))
    expect(body.roster.taxi.map((p: { id: string }) => p.id)).toEqual(['rk1'])
    expect(body.roster.bench).toEqual([])
  })

  it('is not offered in a league with no taxi squad', async () => {
    stub(0, true)
    render(<RosterBoard leagueId="L1" />)
    await screen.findByTestId('roster-move-ir-rk1')
    expect(screen.queryByTestId('roster-move-taxi-rk1')).toBeNull()
  })

  it('when the save is refused, the board goes back to the saved roster and says why', async () => {
    const fetchMock = stub(3, false)
    render(<RosterBoard leagueId="L1" />)
    fireEvent.click(await screen.findByTestId('roster-move-taxi-rk1'))
    expect(await screen.findByText(/locked after week 6/)).toBeTruthy()
    // Read back from the server, and the player is offered "Taxi" again because he is still on the bench.
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/league/roster')).length).toBeGreaterThanOrEqual(2))
    expect(await screen.findByTestId('roster-move-taxi-rk1')).toBeTruthy()
  })
})
