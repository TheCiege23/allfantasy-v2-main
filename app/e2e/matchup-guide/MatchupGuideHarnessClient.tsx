'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import Matchup from '@/components/core-app/screens/Matchup'
import type { MatchupData, MatchupPlayerCell, MatchupSlot } from '@/lib/core-app/matchup'

/**
 * Harness only (app/e2e is 404 in production). SAMPLE data throughout — players, teams and numbers are
 * invented to exercise the Matchup guide.
 */
function cell(name: string, over: Partial<MatchupPlayerCell> = {}): MatchupPlayerCell {
  return {
    playerId: name, sleeperId: null, name, position: 'WR', team: 'SMA', sport: 'NFL', imageUrl: null,
    projected: 10, afEngine: null, actual: null, empty: false, unavailable: null, gameState: 'final', ...over,
  } as MatchupPlayerCell
}

const SUN = '2026-11-15T21:25:00.000Z'

function slots(): MatchupSlot[] {
  return [
    { slotLabel: 'QB', you: cell('Sample Quarterback', { position: 'QB', actual: 24.6 }), opponent: cell('Sample Their QB', { position: 'QB', team: 'SMC', projected: 24.1, gameState: 'upcoming', actual: 0, kickoff: SUN, opponentClub: 'SMD', home: true }) },
    { slotLabel: 'RB', you: cell('Sample Runner', { position: 'RB', actual: 14.2, gameState: 'live' }), opponent: cell('Sample Their RB', { position: 'RB', team: 'SMC', projected: 17.8, gameState: 'upcoming', actual: 0, kickoff: SUN, opponentClub: 'SMD', home: true }) },
    { slotLabel: 'WR', you: cell('Sample Receiver', { team: 'SMD', projected: 18.4, gameState: 'upcoming', actual: 0, kickoff: SUN, opponentClub: 'SMC', home: false }), opponent: cell('Sample Their WR', { actual: 21.4 }) },
    { slotLabel: 'FLEX', you: cell('Sample Flex', { position: 'RB', projected: 15.2, gameState: 'upcoming', actual: 0, kickoff: SUN, opponentClub: 'SMC', home: false }), opponent: cell('Sample Their Flex', { position: 'RB', actual: 12, gameState: 'live' }) },
  ]
}

function data(state: 'upcoming' | 'live' | 'final'): MatchupData {
  const scored = state !== 'upcoming'
  const team = (teamName: string, isYou: boolean) => ({ teamName, ownerName: isYou ? 'samplemanager' : 'rival', record: isYou ? '5-4' : '7-2', isYou, avatarUrl: null })
  return {
    league: { id: 'L1', name: 'Sample Redraft League', platform: 'sleeper', sport: 'NFL', logoUrl: null, sourceLink: null, lineupLink: null },
    week: { available: true, data: { week: 10, season: 2026, isFinal: state === 'final' } },
    teams: { available: true, data: { you: team('Sample Team', true), opponent: team('Sample Rival', false) } },
    sides: scored
      ? { available: true, data: { you: { ...team('Sample Team', true), points: state === 'final' ? 112.4 : 38.8 }, opponent: { ...team('Sample Rival', false), points: state === 'final' ? 104.9 : 46.2 } } }
      : { available: false, reason: 'not scored yet' },
    lineups: { available: true, data: slots() },
    identityNote: null,
    playerScoring: scored ? { available: true, data: { playersScored: 8, source: 'sleeper' } } : { available: false, reason: 'projections' },
    winProbability: { available: true, data: { pWin: 0.59, detail: 'model', confidence: 'low' } },
    projectedFinal: { available: true, data: { you: 132.2, opponent: 125.9, model: 'starters', unprojected: { you: 0, opponent: 0 } } },
    yetToPlay: { available: false, reason: 'tally' },
    starterCountsBySide: {
      you: { upcoming: 2, live: 1, final: 1, unknown: 0 },
      opponent: { upcoming: 2, live: 1, final: 1, unknown: 0 },
    },
    headToHead: { wins: 2, losses: 1, ties: 0, meetings: [{ you: 118.2, them: 101.4, week: 4 }] },
  } as unknown as MatchupData
}

export default function MatchupGuideHarnessClient({ state }: { state: 'upcoming' | 'live' | 'final' }) {
  return (
    <AfCoreShell
      active="matchup"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="matchup-guide-harness">
        <Matchup data={data(state)} />
      </div>
    </AfCoreShell>
  )
}
