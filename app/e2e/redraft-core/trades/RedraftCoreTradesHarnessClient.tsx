'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { TradeCenter } from '@/components/core-app/screens/TradeCenter'
import Trades from '@/components/core-app/screens/Trades'
import Scout from '@/components/core-app/screens/Scout'
import ConnectedFranchiseWarRoom from '@/components/core-app/screens/ConnectedFranchiseWarRoom'
import { coreShellRedraftSport } from '@/lib/core-app/coreShellRedraftIdentity'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { HARNESS_LEAGUE_ID, franchiseSidesFixture, scoutFixture, tradesFixture } from './fixtures'

export type HarnessScreen = 'trades' | 'war-room'

type Props = { screen: HarnessScreen; sport: string; platform: string; leagueType: string; identityOff: boolean; deadline: string; franchise: boolean }

/**
 * Harness only (app/e2e is 404 in production). The chrome is the real AfCoreShell and the body is the
 * REAL /core screen components — TradeCenter with Trades as its history (exactly as the /core page
 * composes them), or Scout with the connected-franchise room above it — fed fixture props. The
 * client-side reads those screens make are answered by the capture script, never by a route handler.
 */
export default function RedraftCoreTradesHarnessClient(props: Props) {
  const sport = normalizeToSupportedSport(props.sport)
  const league = { id: HARNESS_LEAGUE_ID, name: 'Sunday Night Redraft', platform: props.platform, mark: 'SN', sport }
  const redraftSport = props.identityOff ? null : coreShellRedraftSport({ platform: props.platform, sport, leagueType: props.leagueType })
  const trades = tradesFixture(props.deadline)
  return (
    <AfCoreShell
      active={props.screen}
      leagues={[league]}
      selectedLeagueId={league.id}
      nativeLeague
      redraftSport={redraftSport}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="redraft-core-trades-fixture" data-screen={props.screen}>
        {props.screen === 'trades' ? (
          <TradeCenter
            viewerId="e2e-viewer"
            league={{ id: trades.league.id, name: trades.league.name, format: 'Redraft · Half PPR', teamCount: 12 }}
            deadlineLabel={trades.deadline.available && trades.deadline.data.week != null ? `Deadline · week ${trades.deadline.data.week}` : null}
            deadlineCountdown={trades.deadlineCountdown ?? null}
            pickTradeDeadline={null}
            platform={trades.league.platform}
            sourceLink={null}
            leagueType="redraft"
            sport={sport}
            leagueVariant={null}
            leagues={null}
            valueActions={null}
            depthAccess={null}
            history={<Trades data={trades} hidePending />}
            completedHistory={trades.history.available ? trades.history.data : []}
            edgeAccess={null}
          />
        ) : (
          <>
            {props.franchise ? (
              <ConnectedFranchiseWarRoom
                headingLevel={2}
                linkId="e2e-link"
                franchiseName="Ciege Franchise"
                primaryMemberId="fm1"
                selectedLeagueId={league.id}
                sides={franchiseSidesFixture(sport)}
              />
            ) : null}
            <Scout
              data={scoutFixture(sport)}
              gamePlanHref="#plan"
              matchupHref="#matchup"
              standingsHref="#standings"
              tradesHref="#trades"
            />
          </>
        )}
      </div>
    </AfCoreShell>
  )
}
