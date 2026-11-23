'use client'

import { useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { KeeperSelectionTab } from '@/app/league/[leagueId]/tabs/KeeperSelectionTab'
import { KeeperCommissionerDashboard } from '@/app/league/[leagueId]/components/KeeperCommissionerDashboard'
import { KeeperWarRoomPanel } from '@/app/league/[leagueId]/tabs/keeper/KeeperWarRoomPanel'
import { KeeperModal } from '@/app/league/[leagueId]/tabs/settings/KeeperModal'
import type { LeagueTeamBrief } from '@/app/league/[leagueId]/tabs/settings/types'
import { KEEPER_LEAGUE_ID, KEEPER_SETTINGS_TEAMS, installKeeperHarnessFetch, type KeeperHarnessState, type KeeperHarnessTab } from './fixtures'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'

/**
 * The tab list LeagueShell builds for a keeper league in its keeper window: 'keeper' is PREPENDED there
 * (LeagueShell: `if (league.leagueType === 'keeper' && league.keeperPhaseActive) base = [{ id: 'keeper', … }, …base]`).
 * The workspace's six-tab navigation decides where it actually lands.
 */
const TABS = [
  { id: 'keeper', label: 'Keepers' },
  { id: 'native_home', label: 'League home' }, { id: 'matchups', label: 'Matchup' }, { id: 'war_room', label: 'War Room' },
  { id: 'roster', label: 'My team' }, { id: 'waivers', label: 'Players & waivers' }, { id: 'standings', label: 'Standings' },
  { id: 'league_chat', label: 'League chat' }, { id: 'legacy', label: 'Legacy' }, { id: 'trades', label: 'Trades' },
  { id: 'settings', label: 'Settings' }, { id: 'commissioner', label: 'Commissioner tools' },
]

/** Harness only (app/e2e is 404 in production). Real components; data from ./fixtures.ts. */
export default function KeeperLeagueHarnessClient({ tab, state }: { tab: KeeperHarnessTab; state: KeeperHarnessState }) {
  // Synchronously, during the first render, so it is in place before any child effect fetches.
  useState(() => installKeeperHarnessFetch(state))
  const [activeTab, setActiveTab] = useState<string>(tab === 'commissioner' ? 'commissioner' : tab === 'keeper_rosters' ? 'settings' : tab)
  const league: UserLeague = {
    id: KEEPER_LEAGUE_ID,
    name: 'Keepers of the Realm',
    platform: 'allfantasy',
    sport: 'NFL',
    format: 'keeper',
    scoring: 'Half PPR',
    teamCount: 12,
    season: 2027,
    lifecycleState: 'pre_draft',
    leagueType: 'keeper',
    isDynasty: false,
    keeperPhaseActive: state !== 'none',
    isCommissioner: true,
  }
  const body =
    activeTab === 'keeper' ? <KeeperSelectionTab leagueId={league.id} />
    : activeTab === 'war_room' ? <KeeperWarRoomPanel leagueId={league.id} />
    : activeTab === 'commissioner' ? (
      // In the app this sits inside CommissionerSettingsModal's Keepers section; shown here on its own.
      <div className="p-4" data-testid="keeper-harness-commish"><KeeperCommissionerDashboard leagueId={league.id} /></div>
    )
    : activeTab === 'settings' && tab === 'keeper_rosters' ? (
      <KeeperModal open leagueId={league.id} teams={KEEPER_SETTINGS_TEAMS as unknown as LeagueTeamBrief[]} onClose={() => undefined} />
    )
    : <p data-testid="keeper-harness-other-tab">Not part of this harness.</p>
  return (
    <NativeLeagueWorkspace
      native
      league={league}
      leagues={[league]}
      tabs={TABS}
      activeTab={activeTab}
      isCommissioner
      onSelectTab={setActiveTab}
      onOpenSettings={() => setActiveTab('settings')}
      seasonFacts={{ totalWeeks: 17, playoffStartWeek: 15, draftComplete: false }}
      leftPanel={null}
      rightPanel={null}
    >
      {body}
    </NativeLeagueWorkspace>
  )
}
