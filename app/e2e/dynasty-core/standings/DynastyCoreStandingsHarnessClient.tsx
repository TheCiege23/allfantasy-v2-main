'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { Standings } from '@/components/core-app/screens/Standings'
import { coreShellDynasty } from '@/lib/core-app/coreShellDynasty'
import { DYNASTY_LEAGUE_ID, DYNASTY_LEAGUE_NAME, dynastyHistoryFixture, dynastyStandingsFixture, type DynastyHistoryMode } from './fixture'

/**
 * Harness only (app/e2e is 404 in production). Chrome and screen are both real — AfCoreShell with
 * `active="standings"` and the Standings screen — fed fixture data (./fixture.ts). `identity=off` renders
 * the shell without the Dynasty Era stamp and Standings without `dynasty`, i.e. exactly what a dynasty
 * league's Standings drew before.
 */
export default function DynastyCoreStandingsHarnessClient({ identityOff, history }: { identityOff: boolean; history: DynastyHistoryMode }) {
  const data = dynastyStandingsFixture()
  const league = { id: DYNASTY_LEAGUE_ID, name: DYNASTY_LEAGUE_NAME, platform: 'sleeper', mark: 'TD', sport: 'NFL' }
  const other = { id: 'e2e-dynasty-core-standings-2', name: 'Sunday Night Redraft', platform: 'sleeper', mark: 'SN', sport: 'NFL' }
  const dynastyEra = !identityOff && coreShellDynasty({ isDynasty: true, leagueType: 'dynasty', format: 'dynasty' })
  return (
    <AfCoreShell
      active="standings"
      leagues={[league, other]}
      selectedLeagueId={league.id}
      nativeLeague={false}
      dynastyEra={dynastyEra}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league, other] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <Standings data={data} dynasty={identityOff ? null : dynastyHistoryFixture(history)} />
    </AfCoreShell>
  )
}
