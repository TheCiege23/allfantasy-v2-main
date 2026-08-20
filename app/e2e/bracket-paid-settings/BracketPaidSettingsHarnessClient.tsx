'use client'

import { LeagueHomeTabs } from '@/components/bracket/LeagueHomeTabs'

const LEAGUE_ID = 'e2e-bracket-paid-settings-league'
const TOURNAMENT_ID = 'e2e-bracket-paid-settings-tournament'
const ENTRY_ID = 'e2e-bracket-entry-1'
const USER_ID = 'e2e-user-1'

const MEMBERS = [
  {
    id: 'm-1',
    userId: USER_ID,
    role: 'OWNER',
    user: { id: USER_ID, displayName: 'E2E Owner', email: 'owner@example.com' },
  },
]

const ENTRIES = [
  {
    id: ENTRY_ID,
    userId: USER_ID,
    name: 'Harness Entry',
    createdAt: new Date().toISOString(),
    insuredNodeId: null,
    user: { id: USER_ID, displayName: 'E2E Owner', email: 'owner@example.com' },
  },
]

const NODES = [
  {
    id: 'node-1',
    slot: 'R1-G1',
    round: 1,
    region: null,
    seedHome: 1,
    seedAway: 8,
    homeTeamName: 'Team Alpha',
    awayTeamName: 'Team Beta',
    sportsGameId: null,
    nextNodeId: null,
    nextNodeSide: null,
    game: null,
  },
]

const PICKS = {
  [ENTRY_ID]: {},
}

export function BracketPaidSettingsHarnessClient() {
  return (
    <main className="min-h-screen bg-[#040915] p-4 text-white">
      <h1 className="mb-3 text-lg font-semibold">Bracket Paid Settings Harness</h1>
      <LeagueHomeTabs
        leagueId={LEAGUE_ID}
        tournamentId={TOURNAMENT_ID}
        currentUserId={USER_ID}
        isOwner
        members={MEMBERS}
        entries={ENTRIES}
        userEntries={ENTRIES}
        nodes={NODES}
        initialPicks={PICKS}
        joinCode="HARNESSCODE"
        maxManagers={12}
        scoringMode="fancred_edge"
        scoringRules={{
          isPaidLeague: true,
          tiebreakerEnabled: true,
          insuranceEnabled: true,
          upsetDeltaEnabled: true,
          leverageBonusEnabled: true,
          roundPoints: { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 },
        }}
      />
    </main>
  )
}
