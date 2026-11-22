'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { LeagueHome } from '@/components/core-app/screens/LeagueHome'
import type { RailMatchup } from '@/lib/core-app/railMatchups'
import { homeFixture } from '../redraft-core/home/fixture'

/** SAMPLE data: the redraft-core fixture without the redraft deck (a keeper-style import), plus a rail row. */
const GUILLOTINE_RAIL = {
  leagueId: 'e2e-redraft-core-home',
  unpaired: true,
  eliminated: false,
  standing: { rank: 6, outOf: 7, overCut: 12.4, basis: 'points', placesAboveCut: 3, cutLine: 61.2, elimination: true },
} as unknown as RailMatchup

export default function LeagueOverviewGuideHarnessClient({ format }: { format: 'h2h' | 'guillotine' }) {
  const base = homeFixture('nfl', { identity: false, leagueType: 'keeper' }).data
  // SAMPLE: the fixture prices no lineups; give this week a win chance so the chip shows.
  const data = base.matchup.available
    ? { ...base, matchup: { ...base.matchup, data: { ...base.matchup.data, winProbability: { pWin: 0.54, detail: 'sample', confidence: 'medium' } } } }
    : base
  const league = { id: data.league.id, name: data.league.name, platform: 'sleeper', mark: 'SK', sport: data.league.sport }
  return (
    <AfCoreShell
      active="home"
      leagues={[league]}
      selectedLeagueId={league.id}
      nativeLeague={false}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <LeagueHome data={data} otherLeagueIssueCount={0} identityInShell rail={format === 'guillotine' ? GUILLOTINE_RAIL : null} />
    </AfCoreShell>
  )
}
