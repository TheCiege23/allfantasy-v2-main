/**
 * Canonical league trade engine — types (in-season, `Roster`-based).
 */

export const LEAGUE_TRADE_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'cancelled',
  'countered',
  'awaiting_votes',
  'awaiting_commissioner',
  'vetoed',
  'scheduled',
  'processed',
  'expired',
] as const

export const TRADE_ITEM_TYPES = [
  'player',
  'rookie_pick',
  'devy_pick',
  'faab',
  'future_pick',
  'specialty_asset',
] as const

export type TradeItemType = (typeof TRADE_ITEM_TYPES)[number]

export const TRADE_REVIEW_TYPES = ['none', 'instant', 'commissioner', 'league_vote'] as const
export type TradeReviewType = (typeof TRADE_REVIEW_TYPES)[number]

export type TradeAssetInput = {
  itemType: TradeItemType
  /** Player id, pick id, or composite key for picks */
  itemReference?: string | null
  fromRosterId: string
  toRosterId: string
  faabAmount?: number | null
  metadata?: Record<string, unknown>
}

export type CreateLeagueTradeInput = {
  leagueId: string
  proposedByUserId: string
  proposerRosterId: string
  receiverRosterId: string
  assets: TradeAssetInput[]
  parentTradeId?: string | null
  /** Expiry hours from now (default 48) */
  expiresInHours?: number
  metadata?: Record<string, unknown>
}
