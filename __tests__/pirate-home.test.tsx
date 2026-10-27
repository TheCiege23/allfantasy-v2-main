import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { PirateHome } from '@/components/pirate/PirateHome'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Pirate Deck', () => {
  it('shows a roster overflow warning and commissioner recovery controls', async () => {
    const dashboard = {
      league: { id: 'league', name: 'Sea Wolves', sport: 'NFL', rosterLimit: 1 },
      rules: { protectionLimit: 3, claimHours: 24, playoffClaims: false },
      season: { playoffStartWeek: 15 },
      week: 9,
      lockAt: '2026-10-29T16:00:00.000Z',
      canEditProtections: false,
      myRosterId: 'winner',
      rosters: [
        { id: 'winner', ownerId: 'commissioner', ownerName: 'Captain', teamName: 'Sea Wolves', players: [
          { id: 'a', playerId: 'a', playerName: 'First Player', position: 'WR', team: 'A', slotType: 'BENCH' },
          { id: 'b', playerId: 'b', playerName: 'Second Player', position: 'RB', team: 'B', slotType: 'BENCH' },
        ] },
        { id: 'loser', ownerId: 'other', ownerName: 'Rival', teamName: 'The Rivals', players: [
          { id: 'c', playerId: 'c', playerName: 'Claimable Player', position: 'QB', team: 'C', slotType: 'BENCH' },
        ] },
      ],
      protections: [],
      claims: [{ id: 'claim', week: 8, winnerRosterId: 'winner', loserRosterId: 'loser', playerId: null,
        offeredPlayerId: null, counterPlayerId: null, status: 'awaiting_selection', deadlineAt: null,
        transferredAt: null, resolutionNote: null }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => dashboard }))
    render(<PirateHome leagueId="league" isCommissioner />)
    await waitFor(() => expect(screen.getByText(/free 1 spot before another acquisition/i)).toBeTruthy())
    expect(screen.getByText('Commissioner review')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start response window' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Void claim' })).toBeTruthy()
  })
})
