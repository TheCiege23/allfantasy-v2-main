'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { LeagueHome } from '@/components/core-app/screens/LeagueHome'
import { coreShellDynasty } from '@/lib/core-app/coreShellDynasty'
import { dynastyHomeFixture } from './fixture'

/**
 * Harness only (app/e2e is 404 in production). Chrome and screen are both real — AfCoreShell with
 * `active="home"` and LeagueHome — fed fixture data (./fixture.ts). `identity=off` renders the shell
 * without the stamp and Home without the deck, i.e. exactly what an imported dynasty league got before.
 */
export default function DynastyCoreHomeHarnessClient({ identityOff, sparse }: { identityOff: boolean; sparse: boolean }) {
  const data = dynastyHomeFixture({ identity: !identityOff, sparse })
  const league = { id: data.league.id, name: data.league.name, platform: 'sleeper', mark: 'TD', sport: 'NFL' }
  const other = { id: 'e2e-dynasty-core-home-2', name: 'Sunday Night Redraft', platform: 'sleeper', mark: 'SN', sport: 'NFL' }
  const dynastyEra = !identityOff && coreShellDynasty({ isDynasty: true, leagueType: 'dynasty', format: 'dynasty' })
  return (
    <AfCoreShell
      active="home"
      leagues={[league, other]}
      selectedLeagueId={league.id}
      nativeLeague={false}
      dynastyEra={dynastyEra}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league, other] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <LeagueHome data={data} otherLeagueIssueCount={0} identityInShell />
    </AfCoreShell>
  )
}
