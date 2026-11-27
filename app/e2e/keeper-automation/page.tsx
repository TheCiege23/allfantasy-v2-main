'use client'

/**
 * Harness only (app/e2e is 404 in production — app/e2e/layout.tsx). DB-free visual review of the AF
 * Commissioner keeper automation, with the REAL components and the REAL placement:
 *
 *   ?view=settings   the "Place keepers on the draft board for me" switch — locked (free / AF Pro) and on
 *   ?view=board      a 4-team snake board whose keepers were placed by lib/keeper/keeperBoardPlacement.ts:
 *                    a normal keeper, a same-round collision, a traded pick, and one flagged (no pick left)
 *   ?view=card       the player card's keeper line (lib/keeper/keeperCardCostLine.ts), in a keeper league
 */

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { KeeperAutoBoardSetting } from '@/app/league/[leagueId]/components/settings/LeagueSettingsPanel'
import { DraftBoard } from '@/components/app/draft-room/DraftBoard'
import { KeeperRollCall } from '@/components/app/draft-room/KeeperRollCall'
import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import { placeKeepersOnBoard } from '@/lib/keeper/keeperBoardPlacement'
import { describeKeeperCardCost } from '@/lib/keeper/keeperCardCostLine'
import { keeperCostRound, type KeeperRules } from '@/lib/keeper/keeperRules'
import { buildKeeperLocks } from '@/lib/live-draft-engine/keeper/KeeperDraftOrder'
import type { PlayerCardData } from '@/lib/core-app/playerCard'
import '@/components/core-app/af-core.css'
// The sheet's styles ship with PlayerCardProvider, which this harness does not mount.
import '@/components/core-app/af-player-card.css'

const RULES: KeeperRules = { costSystem: 'round_based', roundsEarlier: 1, inflationPerYear: 1, waiverCostRound: null, minCostRound: null, sameRoundRule: 'player_chooses' }
const slotOrder = [
  { slot: 1, rosterId: 'A', displayName: 'Gridiron Gang' },
  { slot: 2, rosterId: 'B', displayName: 'Blitz Brigade' },
  { slot: 3, rosterId: 'C', displayName: 'Red Zone Rebels' },
  { slot: 4, rosterId: 'D', displayName: 'Fourth & Long' },
]
const tradedPicks = [
  { round: 4, originalRosterId: 'B', previousOwnerName: 'Blitz Brigade', newRosterId: 'C', newOwnerName: 'Red Zone Rebels' },
  ...[1, 2, 3, 4, 5].map((round) => ({ round, originalRosterId: 'D', previousOwnerName: 'Fourth & Long', newRosterId: 'A', newOwnerName: 'Gridiron Gang' })),
]
const k = (rosterId: string, playerName: string, position: string, team: string, costRound: number) => ({ rosterId, playerId: playerName, playerName, position, team, costRound })

function Board() {
  const placement = placeKeepersOnBoard(RULES, [
    k('A', 'Bijan Robinson', 'RB', 'ATL', 2),
    k('C', 'Puka Nacua', 'WR', 'LAR', 5),
    k('C', 'Trey McBride', 'TE', 'ARI', 5),
    k('B', 'Jahmyr Gibbs', 'RB', 'DET', 4),
    k('D', 'Brock Bowers', 'TE', 'LV', 3),
  ], { slotOrder, tradedPicks, rounds: 5 })
  const locks = buildKeeperLocks(placement.selections, slotOrder, tradedPicks, 4, 5, 'snake', false)
  const autoPlacement = { at: '2027-08-30T23:00:00Z', placed: placement.selections.length, moved: placement.selections.filter((s) => s.placementNote).length, flagged: placement.flagged }
  return (
    <div className="space-y-3">
      <KeeperRollCall locks={locks} teamCount={4} currentUserRosterId="A" autoPlacement={autoPlacement} />
      <DraftBoard picks={[]} slotOrder={slotOrder} tradedPicks={tradedPicks} teamCount={4} rounds={5} sport="NFL" draftType="snake"
        thirdRoundReversal={false} currentOverallPick={1} keeperLocks={locks} currentUserRosterId="A" />
    </div>
  )
}

function Card() {
  const cost = keeperCostRound(RULES, { lastRound: 6, yearsKept: 0, totalRounds: 15 })
  const keeperCost = describeKeeperCardCost({ rules: RULES, cost, basis: 'drafted', lastRound: 6, valuation: { marketRank: 14, teams: 12 } })
  const no = (reason: string) => ({ available: false as const, reason })
  const data = {
    context: 'league',
    player: { externalId: '9509', sleeperId: '9509', sport: 'NFL', name: 'Bijan Robinson', position: 'RB', team: 'ATL', number: 7, imageUrl: null },
    bio: { age: 25, height: null, weight: null, yearsExp: 3, college: null },
    market: no('No price.'), ownership: no('No ownership.'), schedule: no('No schedule.'), byeWeek: null,
    trades: no('No trades.'), comps: no('No comps.'), news: no('No news.'), injury: no('No injury.'), injuryFeed: no('No feed.'),
    insight: null,
    league: {
      leagueId: 'kp-harness', leagueName: 'Keepers of the Realm', platform: 'allfantasy', slot: 'STARTER', isYours: true,
      owner: { teamName: 'Gridiron Gang', ownerName: 'You' }, price: no('No price.'), yourRoster: [], trades: [],
      playoffSchedule: no('No playoffs.'), watched: false,
      tradeBlock: { supported: false, note: '', listed: false, byYou: false, teamName: null, since: null },
    },
    follow: null, depth: null, keeperCost,
  } as unknown as PlayerCardData
  return (
    <PlayerCardSheet subject={{ sport: 'NFL', sleeperId: '9509', name: 'Bijan Robinson', position: 'RB', team: 'ATL', leagueId: 'kp-harness' }}
      data={data} status="ready" onClose={() => undefined} onOpen={() => undefined} />
  )
}

function View() {
  const view = useSearchParams().get('view') ?? 'board'
  return (
    <main className="min-h-screen space-y-6 bg-[#040915] p-4 text-[13px] text-white" data-testid={`keeper-automation-${view}`}>
      {view === 'settings' ? (
        <>
          <section className="space-y-2" data-testid="kp-auto-board-free">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-sky-300/90">Free or AF Pro commissioner</p>
            <KeeperAutoBoardSetting enabled={false} disabled={false} hasAccess={false} onUpgrade={() => undefined} onChange={() => undefined} />
          </section>
          <section className="space-y-2" data-testid="kp-auto-board-commish">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-sky-300/90">AF Commissioner / AF Supreme</p>
            <KeeperAutoBoardSetting enabled disabled={false} hasAccess onUpgrade={() => undefined} onChange={() => undefined} />
          </section>
        </>
      ) : view === 'card' ? <Card /> : <Board />}
    </main>
  )
}

export default function KeeperAutomationHarnessPage() {
  return (
    <Suspense fallback={null}>
      <View />
    </Suspense>
  )
}
