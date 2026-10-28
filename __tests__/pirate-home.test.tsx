import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
      lineupRulings: [{ claimId: 'claim', source: 'automatic', decision: 'forfeit', reason: 'A legal lineup was available from a verified pickup.' }],
      lineupEvidence: { claim: { decision: 'forfeit', reason: 'One verified pickup could complete the lineup.', issues: ['QB: 1 empty'],
        eventAt: '2026-10-26T00:20:00Z', snapshotCount: 2, snapshot: { capturedAt: '2026-10-26T00:22:00Z',
          injurySyncAt: '2026-10-26T00:15:00Z', lineupCertified: true, waiverWitnessCount: 1, players: [
            { playerId: 'free-qb', playerName: 'Verified Free QB', slotType: 'WAIVER', injuryStatus: null,
              kickoffAt: '2026-10-26T00:20:00Z', availabilityKnown: true, waiverVerified: true },
          ] } } },
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
    expect(screen.getByText(/Automatic lineup ruling/)).toBeTruthy()
    fireEvent.click(screen.getByText(/Captured lineup evidence/))
    expect(screen.getByText('Verified Free QB')).toBeTruthy()
    expect(screen.getByText(/Verified immediate pickup before this lock/)).toBeTruthy()
  })
})
