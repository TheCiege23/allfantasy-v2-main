'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { TradeCenter } from '@/components/core-app/screens/TradeCenter'
import Trades from '@/components/core-app/screens/Trades'
import { coreShellDynasty } from '@/lib/core-app/coreShellDynasty'
import { HARNESS_LEAGUE_ID, tradesFixture } from '../../redraft-core/trades/fixtures'

/** Harness only (app/e2e is 404 in production): the real AfCoreShell and TradeCenter on fixture data. */
export default function DynastyCoreTradesHarnessClient({ off }: { off: boolean }) {
  const league = { id: HARNESS_LEAGUE_ID, name: 'The Deep!', platform: 'sleeper', mark: 'TD', sport: 'NFL' }
  const trades = tradesFixture('open')
  const dynasty = !off && coreShellDynasty({ isDynasty: true })
  return (
    <AfCoreShell
      active="trades"
      leagues={[league]}
      selectedLeagueId={league.id}
      nativeLeague={false}
      dynastyEra={dynasty}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <TradeCenter
        viewerId="e2e-viewer"
        league={{ id: trades.league.id, name: 'The Deep!', format: 'Dynasty · Superflex', teamCount: 12 }}
        deadlineLabel={trades.deadline.available && trades.deadline.data.week != null ? `Deadline · week ${trades.deadline.data.week}` : null}
        deadlineCountdown={null}
        pickTradeDeadline={null}
        platform="sleeper"
        sourceLink={null}
        leagueType="dynasty"
        dynasty={dynasty}
        sport="NFL"
        leagueVariant={null}
        leagues={null}
        valueActions={null}
        depthAccess={null}
        history={<Trades data={trades} hidePending />}
        completedHistory={trades.history.available ? trades.history.data : []}
        edgeAccess={null}
      />
    </AfCoreShell>
  )
}
