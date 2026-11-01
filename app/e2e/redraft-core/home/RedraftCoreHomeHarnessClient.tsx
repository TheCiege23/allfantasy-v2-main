'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { LeagueHome } from '@/components/core-app/screens/LeagueHome'
import { homeFixture } from './fixture'

type Props = { sport: string; identityOff: boolean; leagueType: string }

/**
 * Harness only (app/e2e is 404 in production). Chrome and screen are both real — AfCoreShell with
 * `active="home"` and LeagueHome — fed fixture data (./fixture.ts). `identity=off` renders the
 * shell without the stamp and Home without the deck, i.e. exactly what an imported redraft league
 * got before batch B-ID.
 */
export default function RedraftCoreHomeHarnessClient(props: Props) {
  const { data, redraftSport } = homeFixture(props.sport, { identity: !props.identityOff, leagueType: props.leagueType })
  const league = { id: data.league.id, name: data.league.name, platform: 'sleeper', mark: 'SN', sport: data.league.sport }
  const other = { id: 'e2e-redraft-core-home-2', name: 'Office Dynasty', platform: 'sleeper', mark: 'OD', sport: 'NFL' }
  return (
    <AfCoreShell
      active="home"
      leagues={[league, other]}
      selectedLeagueId={league.id}
      nativeLeague={false}
      redraftSport={redraftSport?.sport ?? null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league, other] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <LeagueHome data={data} otherLeagueIssueCount={0} identityInShell />
    </AfCoreShell>
  )
}
