import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * The home exposure card's "if he sits" breakdown as rendered (user decisions,
 * 2026-09-14). The per-league numbers come from the loader; this file proves the row
 * asks the existing player-card route for them only on tap, and never renders a league
 * it cannot price as a number.
 */

vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import { ExposureRowItem } from '@/components/core-app/screens/ExposureImpact'
import type { ExposureRow } from '@/lib/core-app/dash3aPanels'
import type { PlayerLeagueImpact } from '@/lib/core-app/playerLeagueImpact'

const ROW: ExposureRow = { playerId: '4046', name: 'Patrick Mahomes', position: 'QB', team: 'KC', count: 3, of: 5, everyStart: false }

const IMPACT: PlayerLeagueImpact = {
  playerId: '4046',
  rows: [
    { leagueId: 'L1', leagueName: 'Dynasty', platform: 'sleeper', slot: 'starter', impact: { kind: 'priced', now: 0.63, without: 0.41 } },
    { leagueId: 'L2', leagueName: 'Redraft', platform: 'sleeper', slot: 'bench', impact: { kind: 'not_starting' } },
    {
      leagueId: 'L3',
      leagueName: 'ESPN league',
      platform: 'espn',
      slot: 'starter',
      impact: { kind: 'unpriced', reason: '2 starters could not be priced under this league\'s scoring' },
    },
  ],
  notPriced: 1,
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ impact: IMPACT }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ExposureRowItem', () => {
  it('a player on one roster has no breakdown to open', () => {
    render(<ExposureRowItem row={{ ...ROW, count: 1 }} />)
    expect(screen.queryByRole('button', { name: 'If he sits' })).toBeNull()
  })

  it('🛑 fetches only on tap, from the existing player-card route, and shows now → without', async () => {
    render(<ExposureRowItem row={ROW} />)
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'If he sits' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/core/player-card?sport=NFL&sleeperId=4046&impact=1')

    expect(await screen.findByText('63% → 41% (−22)')).toBeTruthy()
    expect(screen.getByText('Dynasty').closest('li')?.getAttribute('data-drop')).toBe('big')
  })

  it('🛑 a benched or unpriceable league says why, never shows a number', async () => {
    render(<ExposureRowItem row={ROW} />)
    fireEvent.click(screen.getByRole('button', { name: 'If he sits' }))

    expect(await screen.findByText('not in this week’s lineup — no effect')).toBeTruthy()
    const unpriced = screen.getByText('can’t price this matchup')
    expect(unpriced.getAttribute('title')).toMatch(/could not be priced/)
    expect(screen.getByText(/1 more league not priced here/)).toBeTruthy()
    expect(screen.queryByText(/0%/)).toBeNull()
  })

  it('closing and reopening does not fetch again', async () => {
    render(<ExposureRowItem row={ROW} />)
    fireEvent.click(screen.getByRole('button', { name: 'If he sits' }))
    await screen.findByText('63% → 41% (−22)')
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    fireEvent.click(screen.getByRole('button', { name: 'If he sits' }))
    await screen.findByText('63% → 41% (−22)')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a failed request says so instead of an empty list', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 503 }))
    render(<ExposureRowItem row={ROW} />)
    fireEvent.click(screen.getByRole('button', { name: 'If he sits' }))
    await waitFor(() => expect(screen.getByText(/Couldn’t load his leagues/)).toBeTruthy())
  })
})
