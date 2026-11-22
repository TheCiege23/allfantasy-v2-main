'use client'

import { useState } from 'react'
import type { UserLeague, UserLeagueTeam } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { NativeLeagueHome } from '@/components/league/native/NativeLeagueHome'
import { WhatsNextPanel } from '@/components/league/whats-next/WhatsNextPanel'
import { DevyBucketCounts, IdpViewSwitch, type IdpViewMode } from '@/components/league/native/ImportedLeagueExtras'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'

/**
 * The tab list an imported Fantrax dynasty league gets from LeagueShell: League home first, as for a native league
 * (2026-11-22), then Decide and the rest. League home renders the real What's next? and NativeLeagueHome in imported
 * mode; every other tab body is a labelled placeholder, because those screens are unchanged here.
 */
const TABS = [
  'native_home:League home', 'decide:Decide', 'draft_intel:Live Intel', 'roster:My Team', 'matchups:Matchups',
  'standings:Standings', 'trades:Trades', 'dynasty:Dynasty', 'dynasty_taxi:Taxi', 'dynasty_picks:Picks',
  'settings:Settings', 'legacy:Legacy', 'activity:Activity', 'news:News',
].map(entry => { const [id, label] = entry.split(':'); return { id: id!, label: label! } })

const IMPORTED: UserLeague = {
  id: 'e2e-imported-fantrax',
  name: 'Road To Glory NCAA Football',
  platform: 'fantrax',
  platformLeagueId: 'e2e-fantrax-league',
  sport: 'NCAAF',
  format: 'dynasty',
  scoring: 'College',
  teamCount: 140,
  season: 2026,
  lifecycleState: 'in_season',
  status: 'in_season',
  currentWeek: 12,
  leagueType: 'dynasty',
  isDynasty: true,
  isCommissioner: true,
} as UserLeague

const NATIVE: UserLeague = {
  id: 'e2e-native-zombie',
  name: 'Zombie Chimmy Test',
  platform: 'allfantasy',
  sport: 'NFL',
  format: 'redraft',
  teamCount: 4,
  season: 2026,
  lifecycleState: 'in_season',
  currentWeek: 12,
  isCommissioner: true,
} as UserLeague

const team = (id: string, teamName: string, wins: number, losses: number, pointsFor: number, claimedByUserId: string | null = null): UserLeagueTeam => ({
  id, externalId: id, teamName, ownerName: teamName, avatarUrl: null, role: 'member', isOrphan: false, claimedByUserId,
  draftPosition: null, wins, losses, ties: 0, pointsFor, pointsAgainst: 0, currentRank: null, faabRemaining: null, waiverPriority: null,
} as UserLeagueTeam)

/** A few of the 140 teams, the viewer's 40th among them: only one is claimed, the case that used to read "1 of 140 joined". */
const TEAMS: UserLeagueTeam[] = [
  team('t1', '#1 Iowa State Cyclones', 23, 1, 3120.4),
  team('t2', '#2 Louisiana Ragin Cajuns', 23, 1, 3051.9),
  team('t3', '#3 Evansville Purple Aces', 23, 1, 2990.2),
  team('t4', '#4 UL Monroe Warhawks', 22, 2, 2950.7),
  team('t5', '#5 Virginia Cavaliers', 22, 2, 2911.3),
  team('t6', '#6 Bowling Green Falcons', 22, 2, 2880.0),
  team('t40', '#40 Georgia Tech Yellow Jackets', 16, 8, 2404.5, 'e2e-viewer'),
]

/** Harness only (app/e2e is 404 in production): the real workspace and League home for an imported league, no database. */
export default function ImportedLeagueWorkspaceHarnessClient({ extras = false }: { extras?: boolean }) {
  const [activeTab, setActiveTab] = useState('native_home')
  const [idpView, setIdpView] = useState<IdpViewMode>('full')
  const tabIds = TABS.map(tab => tab.id)
  return (
    <NativeLeagueWorkspace
      native={false}
      sourceLeagueId="e2e-fantrax-league"
      importActions={null}
      headingExtras={extras ? <DevyBucketCounts stats={{ active: 18, taxi: 3, devy: 6 }} /> : null}
      league={IMPORTED}
      leagues={[IMPORTED, NATIVE]}
      tabs={TABS}
      activeTab={activeTab}
      isCommissioner
      onSelectTab={setActiveTab}
      onOpenSettings={() => setActiveTab('settings')}
      leftPanel={null}
      rightPanel={null}
    >
      {activeTab === 'native_home' ? (
        <div className="wn-home-stack">
          <WhatsNextPanel
            league={IMPORTED}
            userId="e2e-viewer"
            isCommissioner
            hasTeam
            draftDateIso={null}
            availableTabIds={tabIds}
            onSelectTab={setActiveTab}
            imported={{ platform: 'fantrax', sourceLeagueId: 'e2e-fantrax-league', season: 2026, name: IMPORTED.name, status: 'in_season' }}
          />
          <NativeLeagueHome
            league={IMPORTED}
            teams={TEAMS}
            userTeamId="t40"
            isCommissioner
            draftDateIso={null}
            snapshot={null}
            settingsOpen={false}
            onOpenSettings={() => setActiveTab('settings')}
            onSelectTab={setActiveTab}
            availableTabIds={tabIds}
            imported
          />
        </div>
      ) : extras && activeTab === 'roster' ? (
        <div><IdpViewSwitch value={idpView} onChange={setIdpView} /><p data-testid="imported-harness-tab">Tab body: roster, IDP view {idpView} (unchanged screen)</p></div>
      ) : (
        <p data-testid="imported-harness-tab">Tab body: {activeTab} (unchanged screen, not part of this harness)</p>
      )}
    </NativeLeagueWorkspace>
  )
}
