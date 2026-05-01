'use client'

/**
 * NFL redraft league dashboard — Playwright harness.
 *
 * Mounts the real `LeagueShell` with a deterministic NFL-redraft fixture so
 * Playwright can verify the Phase 1 settings-gear consolidation (Commit B):
 *   - Tab bar shows exactly the 6 core tabs (no settings/history/war_room).
 *   - Settings gear is visible in the header.
 *   - Clicking the gear opens the league settings modal.
 *   - Audit Log + League History cards render in the modal General grid.
 *   - Commissioner controls are reachable for commissioner fixture users.
 *
 * No real DB / auth / Sleeper data — all props are stubbed in-memory.
 * Internal fetches inside LeagueShell (e.g. /idp/config, /league/settings)
 * are tolerated; they 404 in dev and the shell renders the dashboard anyway.
 */

import type { League, LeagueInvite, LeagueTeam } from '@prisma/client'
import { LeagueShell } from '@/app/league/[leagueId]/LeagueShell'
import type { LeagueDashboardView } from '@/app/league/[leagueId]/league-dashboard-types'

const FIXTURE_LEAGUE_ID = 'e2e-nfl-redraft-fixture'
const FIXTURE_USER_ID = 'e2e-commissioner'
const FIXTURE_USER_NAME = 'E2E Commissioner'

const fixtureTeams = [
  {
    id: 'team-1',
    leagueId: FIXTURE_LEAGUE_ID,
    externalId: 'team-1',
    teamName: 'Midnight Routes',
    ownerName: 'Casey Lane',
    claimedByUserId: FIXTURE_USER_ID,
    avatarUrl: null,
    draftPosition: 1,
  },
  {
    id: 'team-2',
    leagueId: FIXTURE_LEAGUE_ID,
    externalId: 'team-2',
    teamName: 'Sunday Stack',
    ownerName: 'Jules Carter',
    claimedByUserId: 'e2e-manager-2',
    avatarUrl: null,
    draftPosition: 2,
  },
  {
    id: 'team-3',
    leagueId: FIXTURE_LEAGUE_ID,
    externalId: 'team-3',
    teamName: 'Goal Line Syndicate',
    ownerName: 'Morgan Vale',
    claimedByUserId: 'e2e-manager-3',
    avatarUrl: null,
    draftPosition: 3,
  },
] as unknown as LeagueTeam[]

/**
 * Minimal League fixture. Casting through `unknown` is intentional — the real
 * Prisma row has dozens of nullable settings fields (waiver/playoff/IDP/devy
 * defaults) that the rendered code path doesn't read for the gear / tab-bar
 * assertions Commit B's Playwright smoke covers.
 */
const fixtureLeague = {
  id: FIXTURE_LEAGUE_ID,
  userId: FIXTURE_USER_ID,
  platform: 'allfantasy',
  platformLeagueId: FIXTURE_LEAGUE_ID,
  name: 'E2E NFL Redraft',
  sport: 'NFL',
  season: 2026,
  leagueSize: 12,
  scoring: 'half_ppr',
  isDynasty: false,
  rosterSize: 16,
  status: 'pre_draft',
  settings: {
    inviteCode: 'E2E-INVITE',
    draftType: 'snake',
    pickTimerPreset: '120s',
    draft_id: 'sleeper-e2e-draft',
  },
  leagueType: 'redraft',
  leagueVariant: null,
  bestBallMode: false,
  guillotineMode: false,
  keeperPhaseActive: false,
  isCommissioner: true,
  lifecycleState: 'pre_draft',
  teams: fixtureTeams,
  invites: [] as LeagueInvite[],
  rosters: [],
} as unknown as League & {
  teams: LeagueTeam[]
  invites: LeagueInvite[]
  rosters?: { platformUserId: string; faabRemaining: number | null; waiverPriority: number | null }[]
}

const fixtureLeagueDashboard: LeagueDashboardView = {
  settingsRows: [],
  standings: { mode: 'standard' },
  scoring: null,
}

export default function NflRedraftLeagueDashboardHarnessClient() {
  return (
    <div data-testid="nfl-redraft-league-dashboard-harness" className="min-h-screen bg-[#060b18] text-white">
      <LeagueShell
        league={fixtureLeague}
        userTeam={null}
        isOwner
        isCommissioner
        isHeadCommissioner
        allLeagues={[fixtureLeague]}
        userId={FIXTURE_USER_ID}
        userName={FIXTURE_USER_NAME}
        userImage={null}
        draftDateIso={'2026-09-03T00:30:00.000Z'}
        sleeperCommissionerId={null}
        sleeperUsersByPlatformId={{}}
        currentSleeperUserId={null}
        leagueDashboard={fixtureLeagueDashboard}
      />
    </div>
  )
}
