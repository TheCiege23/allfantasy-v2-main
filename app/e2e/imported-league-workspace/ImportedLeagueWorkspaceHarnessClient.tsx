'use client'

import { useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'

/**
 * The tab list an imported Fantrax dynasty league gets from LeagueShell (no League home: Decide comes first). Only the
 * workspace is under test here; every tab body is a labelled placeholder, because the screens themselves are
 * unchanged by moving imported leagues into this workspace (2026-11-22).
 */
const TABS = [
  'decide:Decide', 'draft_intel:Live Intel', 'roster:My Team', 'matchups:Matchups', 'standings:Standings',
  'trades:Trades', 'dynasty:Dynasty', 'dynasty_taxi:Taxi', 'dynasty_picks:Picks', 'settings:Settings',
  'legacy:Legacy', 'activity:Activity', 'news:News',
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

/** Harness only (app/e2e is 404 in production): the real workspace for an imported league, no database. */
export default function ImportedLeagueWorkspaceHarnessClient() {
  const [activeTab, setActiveTab] = useState('decide')
  return (
    <NativeLeagueWorkspace
      native={false}
      sourceLeagueId="e2e-fantrax-league"
      importActions={null}
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
      <p data-testid="imported-harness-tab">Tab body: {activeTab} (unchanged screen, not part of this harness)</p>
    </NativeLeagueWorkspace>
  )
}
