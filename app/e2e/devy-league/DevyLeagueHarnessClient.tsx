'use client'

import { useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { DevyHome } from '@/components/devy/DevyHome'
import { DEVY_LEAGUE_ID, installDevyHarnessFetch, moodSeason, type DevyHarnessMood, type DevyHarnessTab } from './fixtures'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'

/**
 * The tab list LeagueShell builds for a native Devy dynasty league: the Dynasty group (Dynasty, Taxi, Picks) with
 * 'devy' appended to it (LeagueShell: `...(isDevyWorkspaceLeague(league) ? [{ ...DEVY_TAB }] : [])`). The
 * workspace's navigation decides where it actually lands.
 */
const TABS = [
  { id: 'native_home', label: 'League home' }, { id: 'matchups', label: 'Matchups' }, { id: 'roster', label: 'My Team' },
  { id: 'dynasty', label: 'Dynasty' }, { id: 'dynasty_taxi', label: 'Taxi' }, { id: 'dynasty_picks', label: 'Picks' },
  { id: 'devy', label: 'Devy pipeline' },
  { id: 'players', label: 'Players' }, { id: 'waivers', label: 'Waivers' }, { id: 'trades', label: 'Trades' },
  { id: 'standings', label: 'Standings' }, { id: 'league_chat', label: 'League Chat' }, { id: 'settings', label: 'Settings' },
]

/** Harness only (app/e2e is 404 in production). Real components; data from ./fixtures.ts. */
export default function DevyLeagueHarnessClient({ tab, mood }: { tab: DevyHarnessTab; mood: DevyHarnessMood }) {
  // Synchronously, during the first render, so it is in place before any child effect fetches.
  useState(() => installDevyHarnessFetch(mood))
  const [activeTab, setActiveTab] = useState<string>(tab)
  const isCommissioner = mood === 'commissioner'
  const league: UserLeague = {
    id: DEVY_LEAGUE_ID,
    name: mood === 'empty' ? 'Campus Futures' : 'Saturday to Sunday Dynasty',
    platform: 'allfantasy',
    sport: 'NFL',
    format: 'dynasty',
    scoring: 'Half PPR',
    teamCount: 12,
    season: moodSeason(mood),
    lifecycleState: mood === 'empty' ? 'pre_draft' : mood === 'offseason' ? 'offseason' : 'in_season',
    currentWeek: mood === 'in_season' || mood === 'commissioner' ? 10 : null,
    leagueType: 'devy',
    leagueVariant: 'devy_dynasty',
    isDynasty: true,
    isCommissioner,
  }
  const body =
    activeTab === 'devy' ? (
      // LeagueShell's 'devy' case wraps DevyHome in this same scroll frame.
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 lg:px-6">
        <DevyHome leagueId={league.id} isCommissioner={isCommissioner} />
      </div>
    )
    : <p data-testid="devy-harness-other-tab">Not part of this harness.</p>
  return (
    <NativeLeagueWorkspace
      native
      league={league}
      leagues={[league]}
      tabs={TABS}
      activeTab={activeTab}
      isCommissioner={isCommissioner}
      onSelectTab={setActiveTab}
      onOpenSettings={() => setActiveTab('settings')}
      seasonFacts={{
        totalWeeks: 17,
        playoffStartWeek: 15,
        currentWeek: mood === 'in_season' || mood === 'commissioner' ? 10 : null,
        draftComplete: mood !== 'empty',
      }}
      leftPanel={null}
      rightPanel={null}
    >
      {body}
    </NativeLeagueWorkspace>
  )
}
