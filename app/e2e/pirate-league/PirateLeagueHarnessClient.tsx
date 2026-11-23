'use client'

import { useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { PirateHome } from '@/components/pirate/PirateHome'
import { PirateRulesEditor } from '@/components/league-settings/home/PirateRulesEditor'
import { PIRATE_LEAGUE_ID, installPirateHarnessFetch, type PirateHarnessState, type PirateHarnessTab } from './fixtures'
import '@/components/core-app/af-core.css'

/** LeagueShell's tab list for a hosted pirate league: 'pirate' sits right after Matchups (LeagueShell ~line 568). */
const TABS = [
  { id: 'native_home', label: 'League home' }, { id: 'matchups', label: 'Matchups' }, { id: 'pirate', label: 'Pirate Deck' },
  { id: 'schedule', label: 'Schedule' }, { id: 'roster', label: 'My Team' }, { id: 'waivers', label: 'Waivers' },
  { id: 'trades', label: 'Trades' }, { id: 'standings', label: 'Standings' }, { id: 'legacy', label: 'Legacy' },
  { id: 'war_room', label: 'War Room' }, { id: 'league_chat', label: 'League Chat' }, { id: 'activity', label: 'Activity' },
  { id: 'commissioner', label: 'Commissioner' }, { id: 'settings', label: '⚙ Settings' },
]

/** Harness only (app/e2e is 404 in production). Real components; data from ./fixtures.ts. */
export default function PirateLeagueHarnessClient({ tab, state, commissioner }: { tab: PirateHarnessTab; state: PirateHarnessState; commissioner: boolean }) {
  useState(() => installPirateHarnessFetch(state))
  const [activeTab, setActiveTab] = useState<string>(tab === 'rules' ? 'settings' : 'pirate')
  const league: UserLeague = {
    id: PIRATE_LEAGUE_ID, name: 'Plunder Bay', platform: 'allfantasy', sport: 'NFL', format: 'redraft', scoring: 'Half PPR',
    teamCount: 10, season: 2026, lifecycleState: 'in_season', currentWeek: 7, leagueType: 'pirate', leagueVariant: 'pirate',
    isDynasty: false, isCommissioner: commissioner,
  } as UserLeague
  const body = activeTab === 'pirate' ? <PirateHome leagueId={league.id} isCommissioner={commissioner} />
    : activeTab === 'settings' ? <div className="p-4"><PirateRulesEditor leagueId={league.id} /></div>
    : <p data-testid="pirate-harness-other-tab">Not part of this harness.</p>
  return (
    <NativeLeagueWorkspace native league={league} leagues={[league]} tabs={TABS} activeTab={activeTab} isCommissioner={commissioner}
      onSelectTab={setActiveTab} onOpenSettings={() => setActiveTab('settings')}
      seasonFacts={{ totalWeeks: 17, playoffStartWeek: 15, draftComplete: true }} leftPanel={null} rightPanel={null}>
      {body}
    </NativeLeagueWorkspace>
  )
}
