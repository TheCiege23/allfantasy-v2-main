/**
 * T2 Trade Value Snapshot builder — assembles an immutable snapshot from assets enriched with their
 * captured value sources. Pure/deterministic; the route persists the result verbatim.
 */

import {
  TRADE_VALUE_SNAPSHOT_VERSION,
  type AssetValueSnapshot,
  type SideTotals,
  type TeamProfile,
  type TradeValueContext,
  type TradeValueSnapshot,
} from './types'
import {
  normalizedFaabValue,
  normalizedPickValue,
  normalizedPlayerValue,
  type ScoringContext,
} from './valueEngine'
import { gradeTrade } from './grader'

export interface EnrichedTradeAsset {
  kind: AssetValueSnapshot['kind']
  fromRosterId: string
  toRosterId: string
  playerId?: string | null
  playerName?: string | null
  position?: string | null
  team?: string | null
  pickSeason?: number | null
  pickRound?: number | null
  pickLabel?: string | null
  faabAmount?: number | null
  sources: AssetValueSnapshot['sources']
}

function internalValueFor(
  asset: EnrichedTradeAsset,
  currentSeason: number | null,
  scoring?: ScoringContext | null,
): number {
  switch (asset.kind) {
    case 'player':
      return normalizedPlayerValue({
        projection: asset.sources.projectionValue,
        adp: asset.sources.adpValue,
        position: asset.position,
        // Slice 14: the captured market value is finally consumed (fallback
        // basis only — see normalizedPlayerValue).
        marketValue: asset.sources.fantasyCalcValue,
        // Slice 16: real league scoring settings (superflex / TE premium / PPR).
        scoring,
      })
    case 'draft_pick':
      return normalizedPickValue({ round: asset.pickRound, pickSeason: asset.pickSeason, currentSeason })
    case 'faab':
      return normalizedFaabValue(asset.faabAmount)
    case 'future_consideration':
    default:
      return 0
  }
}

export function buildTradeValueSnapshot(input: {
  proposerRosterId: string
  receiverRosterId: string
  assets: EnrichedTradeAsset[]
  context: TradeValueContext
  currentSeason?: number | null
  profiles?: { a?: TeamProfile; b?: TeamProfile }
  /** Slice 16 — real league scoring settings. Omitted ⇒ standard 1-QB redraft. */
  scoring?: ScoringContext | null
}): TradeValueSnapshot {
  const currentSeason = input.currentSeason ?? null

  const snapAssets: AssetValueSnapshot[] = input.assets.map((a) => ({
    kind: a.kind,
    fromRosterId: a.fromRosterId,
    toRosterId: a.toRosterId,
    playerId: a.playerId ?? null,
    playerName: a.playerName ?? null,
    position: a.position ?? null,
    team: a.team ?? null,
    pickSeason: a.pickSeason ?? null,
    pickRound: a.pickRound ?? null,
    pickLabel: a.pickLabel ?? null,
    faabAmount: a.faabAmount ?? null,
    sources: a.sources,
    internalValue: internalValueFor(a, currentSeason, input.scoring),
  }))

  const sideFor = (rosterId: string): SideTotals => {
    const assets = snapAssets.filter((x) => x.fromRosterId === rosterId)
    return { rosterId, total: assets.reduce((s, x) => s + x.internalValue, 0), assets }
  }

  const sideA = sideFor(input.proposerRosterId)
  const sideB = sideFor(input.receiverRosterId)
  const { grade, commissionerReview } = gradeTrade(sideA, sideB, input.profiles)

  return {
    version: TRADE_VALUE_SNAPSHOT_VERSION,
    context: input.context,
    sides: [sideA, sideB],
    grade,
    commissionerReview,
  }
}
