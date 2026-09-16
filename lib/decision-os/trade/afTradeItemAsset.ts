import type { TradeAssetSummary } from './dco'

/**
 * One `AfLeagueTradeItem` row, as the canonical evaluator's asset.
 *
 * ── ⚠ EXTRACTED, NOT WRITTEN ─────────────────────────────────────────────────────────────────
 *
 * This lived inline in `app/api/league/trades-panel/route.ts` as the only copy in the repo. The
 * per-trade detail route needed the same mapping to compute roster impact on demand, and a second
 * inline copy is the "two implementations of one rule" defect CLAUDE.md keeps recording: the two
 * would drift the first time someone added a metadata alias to one of them, and a player the list
 * could value would read as unpriced in the detail — with nothing failing. Moved verbatim so the
 * panel's behaviour is byte-for-byte what it was.
 *
 * ⚠ THE PLAYER-ID RULE IS THE LOAD-BEARING LINE. A player item carries its id in `itemReference`;
 * every other item type carries it (if at all) in `metadata.playerId`. Reading only one of those
 * silently drops players from valuation.
 */
export type AfTradeItemRow = {
  itemType: string
  itemReference: string | null
  fromRosterId: string
  toRosterId: string
  faabAmount: number | null
  metadata: unknown
}

export function afTradeItemToAssetSummary(item: AfTradeItemRow): TradeAssetSummary {
  const metadata =
    item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : {}
  const stringValue = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
  const numberValue = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  return {
    assetType: item.itemType,
    itemReference: item.itemReference,
    fromRosterId: item.fromRosterId,
    toRosterId: item.toRosterId,
    playerId: item.itemType.toLowerCase().includes('player') ? item.itemReference : stringValue(metadata.playerId),
    playerName: stringValue(metadata.playerName ?? metadata.name),
    position: stringValue(metadata.position),
    team: stringValue(metadata.team),
    pickSeason: numberValue(metadata.pickSeason ?? metadata.season),
    pickRound: numberValue(metadata.pickRound ?? metadata.round),
    pickNumber: numberValue(metadata.pickNumber),
    pickOriginalRosterId: stringValue(metadata.originalRosterId),
    pickLabel: stringValue(metadata.pickLabel),
    faabAmount: item.faabAmount ?? numberValue(metadata.faabAmount),
  }
}
