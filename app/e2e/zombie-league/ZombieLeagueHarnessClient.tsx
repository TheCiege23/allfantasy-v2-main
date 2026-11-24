'use client'

import { useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { ZombieHome } from '@/components/zombie/ZombieHome'
/*
 * The Zombie field guide, not the whole WarRoomTab: WarRoomTab's import graph reaches lib/prisma.ts
 * (hooks/useLeagueWarRoomCompanion → lib/draft-room), which throws at module load on a dev server with no
 * DATABASE_URL. WarRoomTab mounts exactly this panel for a zombie league.
 */
import { ZombieWarRoomShortcuts } from '@/components/zombie/ZombieWarRoomShortcuts'
import {
  ZOMBIE_LEAGUE_ID,
  ZOMBIE_LEAGUE_NAME,
  ZOMBIE_TOTAL_WEEKS,
  installZombieLeagueHarnessFetch,
  type ZombieLeagueHarnessMood,
  type ZombieLeagueHarnessTab,
} from './fixtures'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'

/*
 * No SpecialtyLeagueAtmosphere here, unlike the Guillotine harness: it has no zombie variant (tournament,
 * survivor, big_brother, guillotine), and LeagueShell mounts none for a zombie league. The zombie look comes
 * from NativeLeagueWorkspace's own zombie banner (isZombieLeagueLike) and ZombieHome's specialty shell.
 */
const TABS = [
  { id: 'zombie', label: 'Zombie' }, { id: 'native_home', label: 'League home' }, { id: 'war_room', label: 'War Room' },
  { id: 'roster', label: 'My team' }, { id: 'standings', label: 'Standings' },
]

/** Harness only (app/e2e is 404 in production). Real components; data from ./fixtures.ts. */
export default function ZombieLeagueHarnessClient({ tab, mood }: { tab: ZombieLeagueHarnessTab; mood: ZombieLeagueHarnessMood }) {
  // Synchronously, during the first render, so it is in place before any child effect fetches.
  useState(() => installZombieLeagueHarnessFetch(mood))
  const [activeTab, setActiveTab] = useState<string>(tab)
  const preseason = mood === 'preseason'
  const league: UserLeague = {
    id: ZOMBIE_LEAGUE_ID,
    name: ZOMBIE_LEAGUE_NAME,
    platform: 'allfantasy',
    sport: 'NFL',
    format: 'redraft',
    scoring: 'Half PPR',
    teamCount: 12,
    season: 2026,
    lifecycleState: preseason ? 'pre_draft' : 'in_season',
    currentWeek: preseason ? 0 : 10,
    leagueType: 'redraft',
    // isZombieLeagueLike matches any of variant / type / format equal to "zombie".
    leagueVariant: 'zombie',
    isDynasty: false,
    isCommissioner: true,
  }
  const body =
    activeTab === 'zombie' ? <ZombieHome leagueId={league.id} />
    : activeTab === 'war_room' ? <div className="p-4"><ZombieWarRoomShortcuts leagueId={league.id} /></div>
    : <p data-testid="zl-harness-other-tab">Not part of this harness.</p>
  return (
    <NativeLeagueWorkspace
      native
      league={league}
      leagues={[league]}
      tabs={TABS}
      activeTab={activeTab}
      isCommissioner
      onSelectTab={setActiveTab}
      onOpenSettings={() => setActiveTab('zombie')}
      seasonFacts={{ totalWeeks: ZOMBIE_TOTAL_WEEKS, playoffStartWeek: 15, draftComplete: !preseason }}
      leftPanel={null}
      rightPanel={null}
    >
      {body}
    </NativeLeagueWorkspace>
  )
}
