import React from 'react'
import { createRoot } from 'react-dom/client'
import { PirateHome } from '@/components/pirate/PirateHome'

const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
const dashboard = {
  league: { id: 'pirate-mobile-fixture', name: 'Sea Wolves', sport: 'NFL', rosterLimit: 2 },
  rules: { protectionLimit: 3, claimHours: 24, selectionHours: 24, overflowGraceHours: 24, playoffClaims: false },
  season: { playoffStartWeek: 15 }, week: 8, lockAt: future, canEditProtections: true,
  myRosterId: 'winner',
  rosters: [
    { id: 'winner', ownerId: 'captain', ownerName: 'Captain', teamName: 'Sea Wolves', players: [
      { id: 'one', playerId: 'one', playerName: 'First Player', position: 'WR', team: 'BUF', slotType: 'STARTER' },
      { id: 'two', playerId: 'two', playerName: 'Second Player', position: 'RB', team: 'DAL', slotType: 'BENCH' },
      { id: 'three', playerId: 'three', playerName: 'Third Player', position: 'QB', team: 'KC', slotType: 'IR' },
    ] },
    { id: 'loser', ownerId: 'rival', ownerName: 'Rival', teamName: 'Harbor Raiders', players: [
      { id: 'four', playerId: 'four', playerName: 'Fourth Player', position: 'QB', team: 'NE', slotType: 'STARTER' },
      { id: 'five', playerId: 'five', playerName: 'Fifth Player', position: 'WR', team: 'NYJ', slotType: 'BENCH' },
    ] },
  ],
  protections: [{ rosterId: 'loser', week: 7, playerIds: ['four'], status: 'active', voidReason: null }],
  claims: [
    { id: 'active', week: 7, winnerRosterId: 'winner', loserRosterId: 'loser', playerId: null,
      offeredPlayerId: null, counterPlayerId: null, status: 'awaiting_selection',
      selectionDeadlineAt: future, deadlineAt: null, overflowGraceUntil: null,
      transferredAt: null, resolutionNote: null, scoreCorrectionNeedsReversal: false },
  ],
}

const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.endsWith('/api/leagues/pirate-mobile-fixture/pirate') && (!init?.method || init.method === 'GET')) {
    return new Response(JSON.stringify(dashboard), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return originalFetch(input, init)
}

createRoot(document.getElementById('root')!).render(<main className="mx-auto min-h-screen max-w-7xl p-3 sm:p-8"><PirateHome leagueId="pirate-mobile-fixture" isCommissioner /></main>)
