'use client'

import { useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { SpecialtyLeagueAtmosphere } from '@/components/league-atmosphere/SpecialtyLeagueAtmosphere'
import { GuillotineTab } from '@/app/league/[leagueId]/tabs/GuillotineTab'
import { WarRoomTab } from '@/app/league/[leagueId]/tabs/WarRoomTab'
import { GUILLOTINE_LEAGUE_ID, GUILLOTINE_WEEK, installGuillotineHarnessFetch, type GuillotineHarnessMood, type GuillotineHarnessTab } from './fixtures'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'

const TABS = [
  { id: 'guillotine', label: 'Guilly' }, { id: 'native_home', label: 'League home' }, { id: 'war_room', label: 'War Room' },
  { id: 'roster', label: 'My team' }, { id: 'standings', label: 'Standings' },
]

const BANNER_LINE: Record<GuillotineHarnessMood, string> = {
  calm: '9 teams remain · lowest score is cut',
  chop_week: 'Chop week · lowest score is cut Tuesday',
  final: 'Final three · one more chop',
  eliminated: 'You were chopped in week 3',
}

/** Harness only (app/e2e is 404 in production). Real components; data from ./fixtures.ts. */
export default function GuillotineLeagueHarnessClient({ tab, mood }: { tab: GuillotineHarnessTab; mood: GuillotineHarnessMood }) {
  // Synchronously, during the first render, so it is in place before any child effect fetches.
  useState(() => installGuillotineHarnessFetch(mood))
  const [activeTab, setActiveTab] = useState<string>(tab)
  const league: UserLeague = {
    id: GUILLOTINE_LEAGUE_ID,
    name: 'Last Team Standing',
    platform: 'allfantasy',
    sport: 'NFL',
    format: 'redraft',
    scoring: 'Half PPR',
    teamCount: 12,
    season: 2026,
    lifecycleState: 'in_season',
    currentWeek: GUILLOTINE_WEEK,
    leagueType: 'redraft',
    leagueVariant: 'guillotine',
    isDynasty: false,
    guillotineMode: true,
    isCommissioner: true,
  }
  const body =
    activeTab === 'guillotine' ? <GuillotineTab leagueId={league.id} sport="NFL" leagueName={league.name} />
    : activeTab === 'war_room' ? <WarRoomTab league={league} sport="NFL" />
    : <p data-testid="gl-harness-other-tab">Not part of this harness.</p>
  return (
    <>
      <SpecialtyLeagueAtmosphere variant="guillotine" mood={mood} />
      <NativeLeagueWorkspace
        native
        league={league}
        leagues={[league]}
        tabs={TABS}
        activeTab={activeTab}
        isCommissioner
        onSelectTab={setActiveTab}
        onOpenSettings={() => setActiveTab('guillotine')}
        guillotineBanner={{ line: BANNER_LINE[mood], mood }}
        seasonFacts={{ totalWeeks: 17, playoffStartWeek: 15, draftComplete: true }}
        leftPanel={null}
        rightPanel={null}
      >
        {body}
      </NativeLeagueWorkspace>
    </>
  )
}
