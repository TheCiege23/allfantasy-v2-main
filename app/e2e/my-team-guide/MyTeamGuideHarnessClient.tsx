'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'

/**
 * Harness only (app/e2e is 404 in production). SAMPLE data throughout — players, teams and numbers are
 * invented to exercise the My team guide.
 */
const KICK = new Date('2026-11-15T18:00:00Z')

function player(id: string, name: string, pos: string, over: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    sleeperId: id,
    name,
    position: pos,
    team: 'SMA',
    sport: 'NFL',
    imageUrl: null,
    gameContext: 'SMA vs SMB · Sun 1:00p ET',
    kickoff: KICK,
    preseason: false,
    venue: null,
    injuryStatus: null,
    ruledOut: false,
    projectedPoints: 14.2,
    afProjectedPoints: 15.1,
    afEngineProjectedPoints: 14.8,
    indoors: false,
    weather: null,
    market: { ownPct: 0.9, startPct: 0.7 },
    onBye: false,
    ...over,
  }
}

function data(mode: 'fix' | 'questionable' | 'set'): MyTeamData {
  const starters = [
    { slotLabel: 'QB', player: player('q1', 'Sample Quarterback', 'QB', { projectedPoints: 22.1 }), empty: false, unresolvedId: null },
    { slotLabel: 'RB', player: player('r1', 'Sample Runner', 'RB', mode === 'fix' ? { ruledOut: true, injuryStatus: 'Out' } : {}), empty: false, unresolvedId: null },
    { slotLabel: 'WR', player: player('w1', 'Sample Receiver', 'WR', mode !== 'set' ? { injuryStatus: 'Questionable' } : {}), empty: false, unresolvedId: null },
    { slotLabel: 'WR', player: player('w2', 'Sample Second WR', 'WR', mode !== 'set' ? { injuryStatus: 'Questionable' } : {}), empty: false, unresolvedId: null },
    { slotLabel: 'TE', player: player('t1', 'Sample Tight End', 'TE', { projectedPoints: 9.8 }), empty: false, unresolvedId: null },
  ]
  return {
    league: { id: 'L1', name: 'Sample Dynasty League', platform: 'sleeper', format: 'dynasty' },
    team: {
      available: true,
      data: {
        teamName: 'Sample Team Name',
        ownerName: 'samplemanager',
        managerAvatarUrl: null,
        record: '9-9',
        recordKnown: true,
        rank: 2,
        pointsFor: 0,
        pointsAgainst: 0,
        teamCount: 12,
      },
    },
    starters: { available: true, data: starters },
    bench: { available: true, data: [player('b1', 'Sample Bench Back', 'RB', { projectedPoints: 11.5 }), player('b2', 'Sample Bench WR', 'WR', { projectedPoints: 10.4 })] },
    ir: { available: false, reason: 'nobody on injured reserve' },
    taxi: { available: false, reason: 'nobody on the taxi squad' },
    lock: { available: true, data: { at: KICK, anyEmptySlot: false, week: 10, season: 2026, daysAway: 2, asOf: Date.parse('2026-11-13T12:00:00Z') } },
    projections: {
      available: true,
      data: { total: 118.4, projected: 5, unprojected: 0, season: '2026', week: 10, afTotal: 131.7, afEngineTotal: 127.3, afProjected: 5, standardComparable: true },
    },
    projectionBasis: { notes: [], scoringKnown: true },
    nextMatchup: {
      available: true,
      data: {
        seasonYear: 2026,
        week: 10,
        you: { rosterId: 4, teamName: 'Sample Team Name', managerName: 'samplemanager', avatarUrl: null, projected: 131.7, projectedFrom: 5, starterCount: 5 },
        opponent: { rosterId: 7, teamName: 'Sample Rival', managerName: 'rival', avatarUrl: null, projected: 118.2, projectedFrom: 5, starterCount: 5 },
        bye: false,
        unpricedReason: null,
      },
    },
    upcomingByes: [
      { week: 11, names: ['Sample Receiver', 'Sample Bench WR', 'Sample Tight End', 'Sample Other One', 'Sample Other Two'] },
    ],
    rosterGrade: {
      available: true,
      data: {
        rank: 3, outOf: 12, value: 41200, median: 38000,
        strongest: { position: 'WR', value: 18400, rank: 2, outOf: 12, playerCount: 7 },
        weakest: { position: 'TE', value: 2100, rank: 11, outOf: 12, playerCount: 2 },
        pricedPlayers: 24, totalPlayers: 26,
        basis: { format: 'DYNASTY', qbFormat: 'ONE_QB', capturedAt: '2026-11-12T00:00:00.000Z', leagueScored: true },
      },
    },
    liveScore: { available: false, reason: 'no live scoring' },
  } as unknown as MyTeamData
}

export default function MyTeamGuideHarnessClient({ mode }: { mode: 'fix' | 'questionable' | 'set' }) {
  return (
    <AfCoreShell
      active="my-team"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="my-team-guide-harness">
        <MyTeam data={data(mode)} />
      </div>
    </AfCoreShell>
  )
}
