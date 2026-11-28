import 'server-only'

import type { LineupImpactSummary } from '@/lib/decision-os/trade/rosterImpactSummary'
import { LEAGUE_WEEK_UNIT } from '@/lib/decision-os/trade/rosterImpactSummary'
import { evaluatePendingProviderTrades } from './evaluatePendingProviderTrades'
import type { EspnOfferView } from './espnOfferView'
import type { PendingProviderTrade, PendingTradeAsset } from './scanPendingSleeperTrades'

/**
 * Lineup impact for ESPN pending offers, through the canonical evaluator's own lineup path — the one
 * Yahoo and Sleeper offers already use (`evaluatePendingProviderTrades`, `includeRosterImpact`).
 *
 * 🛑 ESPN IDS NEVER REACH THE EVALUATOR. The canonical world holds an ESPN roster TRANSLATED into
 * Sleeper ids (`lib/decision-os/world/port.ts`), so the traded players must be in that space too: each
 * view carries `impactIds`, the viewer's side resolved ESPN → Sleeper through `resolveTradePlayers`
 * (NFL, the `espn` space). ESPN 12483 is Matthew Stafford; read raw it is Sleeper's Jack Bech.
 *
 * An offer with ANY player on the viewer's side that did not resolve to exactly one Sleeper id gets a
 * BLOCKED summary with the reason — "Lineup effect not computed: …" — not a number computed without
 * him. The viewer's own conditional drop leaves their lineup, so it rides as a release; the partner's
 * drop is not on the viewer's roster and changes nothing for them.
 *
 * DB-first: the evaluator reads the canonical world from Postgres; nothing here calls ESPN.
 */

export const ESPN_UNRESOLVED_LINEUP_REASON =
  'a player in this ESPN offer could not be matched to a player we track, so we will not guess his lineup effect'

export function unresolvedLineupImpact(): LineupImpactSummary {
  return {
    unit: LEAGUE_WEEK_UNIT,
    week: null,
    startingPointsBefore: null,
    startingPointsAfter: null,
    startingPointsDelta: null,
    blockedReason: ESPN_UNRESOLVED_LINEUP_REASON,
    unpricedExcluded: 0,
    depthChanges: [],
  }
}

const withId = (assets: readonly PendingTradeAsset[], ids: readonly string[]): PendingTradeAsset[] =>
  assets.map((a, i) => ({ ...a, playerId: ids[i] ?? a.playerId }))

export type EspnLineupDeps = { evaluate: typeof evaluatePendingProviderTrades }

/**
 * Per transaction id: the viewer's lineup effect, `null` when the evaluator could not produce one
 * (renders "unavailable right now"), or the blocked summary when a player is unresolved.
 */
export async function espnOfferLineupImpacts(
  leagueId: string,
  views: readonly EspnOfferView[],
  deps: Partial<EspnLineupDeps> = {},
): Promise<Map<string, LineupImpactSummary | null>> {
  const evaluate = deps.evaluate ?? evaluatePendingProviderTrades
  const out = new Map<string, LineupImpactSummary | null>()
  const trades: PendingProviderTrade[] = []
  const releases = new Map<string, readonly string[]>()
  for (const v of views) {
    const ids = v.impactIds
    if (!ids || ids.give.length !== v.trade.assetsGiven.length || ids.get.length !== v.trade.assetsReceived.length) {
      out.set(v.trade.transactionId, unresolvedLineupImpact())
      continue
    }
    trades.push({ ...v.trade, assetsGiven: withId(v.trade.assetsGiven, ids.give), assetsReceived: withId(v.trade.assetsReceived, ids.get) })
    releases.set(v.trade.transactionId, ids.releases)
  }
  if (trades.length === 0) return out
  const evaluations = await evaluate({
    leagueId,
    trades,
    includeRosterImpact: true,
    releasedByViewer: releases,
    recordProposal: false,
  }).catch(() => new Map())
  for (const t of trades) out.set(t.transactionId, evaluations.get(t.transactionId)?.rosterImpact ?? null)
  return out
}
