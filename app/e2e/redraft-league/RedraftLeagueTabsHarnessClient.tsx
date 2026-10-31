'use client'

import { useState } from 'react'
import type { LeagueTeam } from '@prisma/client'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { WarRoomTab } from '@/app/league/[leagueId]/tabs/WarRoomTab'
import { ScoresTab } from '@/app/league/[leagueId]/tabs/ScoresTab'
import { AICoachingTab } from '@/app/league/[leagueId]/tabs/AICoachingTab'
import { ScheduleTab } from '@/app/league/[leagueId]/tabs/ScheduleTab'
import { installHarnessFetch, type HarnessFormat, type HarnessSeason, type HarnessTab } from './fixtures'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'

const TABS = [
  { id: 'native_home', label: 'League home' }, { id: 'war_room', label: 'War Room' }, { id: 'scores', label: 'Live scores' },
  { id: 'ai_coaching', label: 'Chimmy Coaching' }, { id: 'schedule', label: 'Schedule' }, { id: 'standings', label: 'Standings' },
]

/** The same season shape scripts/redraft-visual-capture.mjs uses per sport. */
const SEASONS: Record<string, HarnessSeason> = {
  NFL: { week: 9, total: 17, playoffs: 15, deadline: 12 },
  NBA: { week: 4, total: 21, playoffs: 19, deadline: 16 },
  NHL: { week: 5, total: 22, playoffs: 20, deadline: 17 },
  MLB: { week: 7, total: 26, playoffs: 24, deadline: 20 },
  NCAAF: { week: 6, total: 15, playoffs: 13, deadline: 9 },
  NCAAB: { week: 8, total: 18, playoffs: 16, deadline: 12 },
  SOCCER: { week: 11, total: 38, playoffs: 35, deadline: 26 },
}

const LEAGUE_ID = 'e2e-redraft-league-tabs'

/**
 * Harness only (app/e2e is 404 in production). The workspace and the tab are the real components;
 * their data comes from ./fixtures.ts, answered in the browser, so no request reaches a database.
 */
export default function RedraftLeagueTabsHarnessClient({ tab, sport, format }: { tab: HarnessTab; sport: string; format: HarnessFormat }) {
  const resolved = normalizeToSupportedSport(sport)
  const season = SEASONS[resolved] ?? SEASONS.NFL!
  // Synchronously, during the first render, so it is in place before any child effect fetches.
  useState(() => installHarnessFetch({ leagueId: LEAGUE_ID, sport: resolved, season, format }))
  const [activeTab, setActiveTab] = useState<string>(tab)
  const league: UserLeague = {
    id: LEAGUE_ID,
    name: format === 'redraft' ? 'Sunday Night Redraft' : format === 'dynasty' ? 'Forever Dynasty' : 'Last Team Standing',
    platform: 'allfantasy',
    sport: resolved,
    format: format === 'dynasty' ? 'dynasty' : 'redraft',
    scoring: 'Half PPR',
    teamCount: 12,
    season: 2026,
    lifecycleState: 'in_season',
    currentWeek: season.week,
    leagueType: format === 'dynasty' ? 'dynasty' : 'redraft',
    leagueVariant: format === 'guillotine' ? 'guillotine' : null,
    isDynasty: format === 'dynasty',
    guillotineMode: format === 'guillotine',
    tradeDeadlineWeek: season.deadline,
    isCommissioner: true,
  }
  const userTeam = { id: 'fx-team', teamName: 'Gridiron Ghosts', avatarUrl: null } as unknown as LeagueTeam
  const body =
    activeTab === 'war_room' ? <WarRoomTab league={league} sport={resolved} />
    : activeTab === 'scores' ? <ScoresTab league={league} sport={resolved} />
    : activeTab === 'ai_coaching' ? <AICoachingTab league={league} userTeam={userTeam} sport={resolved} />
    : activeTab === 'schedule' ? <ScheduleTab league={league} isCommissioner={false} />
    : <p data-testid="rdt-harness-other-tab">Not part of this harness.</p>
  return (
    <NativeLeagueWorkspace
      native
      league={league}
      leagues={[league]}
      tabs={TABS}
      activeTab={activeTab}
      isCommissioner
      onSelectTab={setActiveTab}
      onOpenSettings={() => setActiveTab('native_home')}
      guillotineBanner={format === 'guillotine' ? { line: '9 teams remain · lowest score is cut', mood: 'calm' } : null}
      seasonFacts={{ totalWeeks: season.total, playoffStartWeek: season.playoffs, draftComplete: true }}
      leftPanel={null}
      rightPanel={null}
    >
      {body}
    </NativeLeagueWorkspace>
  )
}
