import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { WaiverLineupBoard } from '@/components/core-app/WaiverLineupBoard'

/**
 * "Worth adding" for a league outside the NFL. Every number on it is a per-game season rate, and a
 * surface that printed it as "wk 4" would be making a weekly forecast the number never made.
 */

const NHL_PAYLOAD = {
  state: 'ok',
  season: '2026',
  week: null,
  currentLineupPoints: 61.4,
  sport: 'NHL',
  basis: 'season_per_game_af_default',
  candidates: [
    {
      sleeperId: null,
      playerKey: 'pim-1',
      name: 'Free Winger',
      position: 'LW',
      team: 'TOR',
      projectedPoints: 11.2,
      gain: 3.4,
      displaces: { sleeperId: null, playerKey: 'pim-2', name: 'Bench Winger', projectedPoints: 7.8 },
      basis: 'season_rate',
    },
  ],
  notes: ["Per-game points from AllFantasy's NHL season projection, on AllFantasy's default NHL scoring."],
}

const mockFetch = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })) as never)

afterEach(() => vi.unstubAllGlobals())

describe('WaiverLineupBoard — a season-rate league', () => {
  it('says per game, never a week, and marks each row as a season rate', async () => {
    mockFetch(NHL_PAYLOAD)
    render(<WaiverLineupBoard leagueId="lg1" />)
    await waitFor(() => expect(screen.getByTestId('waiver-lineup-board')).toBeTruthy())
    const text = screen.getByTestId('waiver-lineup-board').textContent ?? ''
    expect(text).toContain('your lineup 61.4 per game')
    expect(text).not.toMatch(/wk /)
    expect(text).toContain('per game · season')
    expect(text).toContain('over Bench Winger')
    expect(text).toContain("AllFantasy's default NHL scoring")
  })

  it('renders the name as text — there is no Sleeper id to open a card on', async () => {
    mockFetch(NHL_PAYLOAD)
    render(<WaiverLineupBoard leagueId="lg1" />)
    await waitFor(() => expect(screen.getByText('Free Winger')).toBeTruthy())
    expect(screen.getByText('Free Winger').tagName).toBe('SPAN')
  })

  it('says per game when nobody would improve the lineup', async () => {
    mockFetch({ ...NHL_PAYLOAD, candidates: [] })
    render(<WaiverLineupBoard leagueId="lg1" />)
    await waitFor(() => expect(screen.getByText(/would improve your starting lineup per game/)).toBeTruthy())
  })

  it('gives a sport with no producer its reason, and the note naming it', async () => {
    mockFetch({
      state: 'no_producer',
      season: null,
      week: null,
      currentLineupPoints: null,
      sport: 'SOCCER',
      candidates: [],
      notes: ['No projection exists for soccer players: our stats provider serves no soccer player season stats.'],
    })
    render(<WaiverLineupBoard leagueId="lg1" />)
    await waitFor(() => expect(screen.getByText(/nothing projects this sport’s players yet/)).toBeTruthy())
    expect(screen.getByText(/No projection exists for soccer players/)).toBeTruthy()
  })
})
