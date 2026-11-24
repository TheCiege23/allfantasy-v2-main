'use client'

import { useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { SalaryCapHome } from '@/components/salary-cap/SalaryCapHome'
import { SALARY_CAP_TABS, isSalaryCapWorkspaceLeague, salaryCapViewForTab } from '@/lib/salary-cap/workspaceTabs'
import { CAP_YEAR, SALARY_CAP_LEAGUE_ID, installSalaryCapHarnessFetch, leagueNameFor, type SalaryCapHarnessMood } from './fixtures'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'

/**
 * The tab list LeagueShell builds for a Salary Cap league: the cap block (SALARY_CAP_TABS) after the base tabs'
 * head, as `isSalaryCapWorkspaceLeague(league)` inserts it. The workspace's navigation decides where it lands.
 */
const TABS = [
  { id: 'native_home', label: 'League home' }, { id: 'matchups', label: 'Matchups' }, { id: 'roster', label: 'My Team' },
  ...SALARY_CAP_TABS.map(({ id, label }) => ({ id, label })),
  { id: 'players', label: 'Players' }, { id: 'waivers', label: 'Waivers' }, { id: 'trades', label: 'Trades' },
  { id: 'standings', label: 'Standings' }, { id: 'league_chat', label: 'League Chat' }, { id: 'settings', label: 'Settings' },
]
const CAP_TAB_IDS = new Set(SALARY_CAP_TABS.map((t) => t.id))

/** Harness only (app/e2e is 404 in production). Real components; data from ./fixtures.ts. */
export default function SalaryCapLeagueHarnessClient({ tab, mood }: { tab: string; mood: SalaryCapHarnessMood }) {
  // Synchronously, during the first render, so it is in place before any child effect fetches.
  useState(() => {
    installSalaryCapHarnessFetch(mood)
    // The workspace restores the last section opened in this league (`af:league-section:<id>`) unless the URL names a
    // ?view=/?tab= — which LeagueShell always mirrors and this harness has no reason to. Without this, the first
    // harness tab visited would win every later visit in the same browser.
    try { window.localStorage.setItem(`af:league-section:${SALARY_CAP_LEAGUE_ID}`, tab) } catch { /* storage is optional */ }
  })
  const [activeTab, setActiveTab] = useState<string>(tab)
  const isCommissioner = mood === 'commissioner' || mood === 'imported'
  const preseason = mood === 'empty' || mood === 'auction'
  const imported = mood === 'commissioner' || mood === 'imported'
  const league: UserLeague = {
    id: SALARY_CAP_LEAGUE_ID,
    name: leagueNameFor(mood),
    platform: imported ? 'sleeper' : 'allfantasy',
    sport: 'NFL',
    format: 'dynasty',
    scoring: 'Half PPR',
    teamCount: 12,
    season: CAP_YEAR,
    lifecycleState: preseason ? 'pre_draft' : 'in_season',
    currentWeek: preseason ? null : 10,
    // The canonical create path writes the type and leaves the variant null; workspaceTabs accepts either.
    leagueType: 'salary_cap',
    leagueVariant: null,
    isDynasty: true,
    isCommissioner,
  }
  if (!isSalaryCapWorkspaceLeague(league)) throw new Error('harness league is not a Salary Cap workspace league')
  const body = CAP_TAB_IDS.has(activeTab) ? (
    // LeagueShell's salary-cap case wraps SalaryCapHome in this same scroll frame.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 lg:px-6">
      <SalaryCapHome leagueId={league.id} initialView={salaryCapViewForTab(activeTab)} shellNav />
    </div>
  ) : (
    <p data-testid="salary-cap-harness-other-tab">Not part of this harness.</p>
  )
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
      seasonFacts={{ totalWeeks: 17, playoffStartWeek: 15, currentWeek: preseason ? null : 10, draftComplete: !preseason }}
      leftPanel={null}
      rightPanel={null}
    >
      {body}
    </NativeLeagueWorkspace>
  )
}
