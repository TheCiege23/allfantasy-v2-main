/**
 * Side-game state as an append-only ledger — the pure fold (no I/O).
 *
 * Every pick, bid, auction, revive, purchase and auction-cash movement is ONE `SurvivorAuditEntry`
 * row (category `side_game`, relatedEntityType `survivor_side_game`), exactly like the reward ledger
 * (`survivorRewardModel.ts`). `foldSideGameLedger` turns the rows back into current state, so there
 * is no new table and no column. Each row carries a `key`; the writer refuses a key it has seen, so
 * a retried request or a second runner tick never doubles anything.
 *
 * Spoiler safety: every row is commissioner-visible and never public. Sealed bids, the picks of
 * others and who holds what are only ever shown back to their owner.
 */

import { EMPTY_POOL_ENTRY, type AuctionBid, type ExileTeamBid, type PickOutcome, type PoolEntryState } from './survivorSideGameRules'
import type { AuctionCurrency, SideGamePrize, TokenShopKind } from './survivorSideGameSettings'

export const SIDE_GAME_CATEGORY = 'side_game'
export const SIDE_GAME_ENTITY = 'survivor_side_game'

export const SIDE_GAME_ACTIONS = {
  tokenPoolPick: 'tp_pick',
  tokenPoolSettled: 'tp_settled',
  tokenPoolCashOut: 'tp_cash_out',
  poolPick: 'pool_pick',
  poolSettled: 'pool_settled',
  poolRevive: 'pool_revive',
  poolReviveGranted: 'pool_revive_granted',
  auctionCreated: 'auction_created',
  auctionStatus: 'auction_status',
  auctionBid: 'auction_bid',
  auctionSettled: 'auction_settled',
  cashCredit: 'cash_credit',
  cashDebit: 'cash_debit',
  shopPurchase: 'shop_purchase',
  shopDelivered: 'shop_delivered',
  exileBid: 'exile_bid',
  exileBidsResolved: 'exile_bids_resolved',
  /** A FAAB charge given back because the auction prize could not be paid (auction cash refunds are a cash_credit carrying `refundOf`). */
  auctionRefund: 'auction_refund',
  /** A Survivor Pool week with no pick, judged by the missed-pick rule. */
  poolMissed: 'pool_missed',
} as const

export const sideGameEntity = {
  tokenPool: (userId: string) => `tokenpool:${userId}`,
  pool: (userId: string) => `pool:${userId}`,
  auction: (auctionId: string) => `auction:${auctionId}`,
  cash: (rosterId: string) => `cash:${rosterId}`,
  shop: (userId: string) => `shop:${userId}`,
  exileBids: (week: number) => `exilebid:${week}`,
}

export interface SideGameLedgerRow {
  action: string
  relatedEntityId: string | null
  week?: number | null
  data: unknown
  createdAt: Date | string
}

export interface TokenPoolPickRecord {
  pickId: string
  week: number
  gameKey: string
  teamKey: string
  at: string
  outcome: PickOutcome | null
  settledBy: 'auto' | 'commissioner' | null
}

export interface TokenPoolState {
  picks: TokenPoolPickRecord[]
  /** Streak mode: tokens won and not yet banked. */
  pot: number
}

export interface PoolPickRecord {
  week: number
  gameKey: string
  teamKey: string
  at: string
  outcome: PickOutcome | null
  settledBy: 'auto' | 'commissioner' | null
}

export interface PoolState {
  entry: PoolEntryState
  picks: PoolPickRecord[]
}

export interface AuctionItem {
  itemId: string
  label: string
  /** A blind item's label is hidden until the auction closes. */
  blind: boolean
  prize: SideGamePrize
}

export type AuctionStatus = 'scheduled' | 'open' | 'closed' | 'settled' | 'cancelled'

export interface AuctionRecord {
  auctionId: string
  label: string
  mode: 'sealed' | 'open'
  currency: AuctionCurrency
  opensAt: string
  closesAt: string
  week: number
  items: AuctionItem[]
  status: AuctionStatus
  bids: AuctionBid[]
  awards: Array<{ itemId: string; rosterId: string; amount: number; rewardId: string | null; paid: boolean; refunded?: boolean }>
  cashGranted: boolean
}

export interface ShopPurchaseRecord {
  purchaseId: string
  userId: string
  rosterId: string | null
  itemId: string
  kind: TokenShopKind
  cost: number
  status: 'pending' | 'delivered'
  rewardId: string | null
  at: string
}

export interface SideGameState {
  tokenPool: Map<string, TokenPoolState>
  pool: Map<string, PoolState>
  auctions: Map<string, AuctionRecord>
  /** rosterId → auction cash held. */
  cash: Map<string, number>
  purchases: ShopPurchaseRecord[]
  exileBids: Map<number, { bids: ExileTeamBid[]; resolved: Array<{ userId: string; team: string; amount: number }> | null }>
  /** Every idempotency key already written. */
  keys: Set<string>
}

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0)
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : String(v))
const outcomeOf = (v: unknown): PickOutcome | null => (v === 'correct' || v === 'wrong' || v === 'push' ? v : null)

export function emptySideGameState(): SideGameState {
  return { tokenPool: new Map(), pool: new Map(), auctions: new Map(), cash: new Map(), purchases: [], exileBids: new Map(), keys: new Set() }
}

/** `refundOf` is `<auctionId>:<itemId>`: that award's charge was given back. */
function markRefunded(s: SideGameState, refundOf: string): void {
  const at = refundOf.lastIndexOf(':')
  const award = s.auctions.get(refundOf.slice(0, at))?.awards.find((w) => w.itemId === refundOf.slice(at + 1))
  if (award) award.refunded = true
}

/** The key a refund is written under — one per award, ever. */
export function auctionRefundKey(auctionId: string, itemId: string): string {
  return `auctionrefund:${auctionId}:${itemId}`
}

function entityTail(id: string, prefix: string): string | null {
  return id.startsWith(prefix) ? id.slice(prefix.length) : null
}

/** Rows MUST be in creation order. Unknown actions are ignored, so old rows never break a read. */
export function foldSideGameLedger(rows: readonly SideGameLedgerRow[]): SideGameState {
  const s = emptySideGameState()
  for (const row of rows) {
    const id = row.relatedEntityId ?? ''
    const d = rec(row.data)
    const key = str(d.key)
    if (key) s.keys.add(key)
    const at = str(d.at) || iso(row.createdAt)
    switch (row.action) {
      case SIDE_GAME_ACTIONS.tokenPoolPick: {
        const userId = entityTail(id, 'tokenpool:')
        if (!userId) break
        const st = s.tokenPool.get(userId) ?? { picks: [], pot: 0 }
        st.picks.push({ pickId: str(d.pickId), week: int(d.week), gameKey: str(d.gameKey), teamKey: str(d.teamKey), at, outcome: null, settledBy: null })
        s.tokenPool.set(userId, st)
        break
      }
      case SIDE_GAME_ACTIONS.tokenPoolSettled: {
        const st = s.tokenPool.get(entityTail(id, 'tokenpool:') ?? '')
        const pick = st?.picks.find((p) => p.pickId === str(d.pickId))
        if (!st || !pick) break
        pick.outcome = outcomeOf(d.outcome)
        pick.settledBy = d.by === 'commissioner' ? 'commissioner' : 'auto'
        st.pot = Math.max(0, int(d.potAfter))
        break
      }
      case SIDE_GAME_ACTIONS.tokenPoolCashOut: {
        const st = s.tokenPool.get(entityTail(id, 'tokenpool:') ?? '')
        if (st) st.pot = 0
        break
      }
      case SIDE_GAME_ACTIONS.poolPick: {
        const userId = entityTail(id, 'pool:')
        if (!userId) break
        const st = s.pool.get(userId) ?? { entry: { ...EMPTY_POOL_ENTRY }, picks: [] }
        // One pick per week: a later pick before lock replaces the earlier one.
        st.picks = st.picks.filter((p) => p.week !== int(d.week) || p.outcome != null)
        st.picks.push({ week: int(d.week), gameKey: str(d.gameKey), teamKey: str(d.teamKey), at, outcome: null, settledBy: null })
        s.pool.set(userId, st)
        break
      }
      case SIDE_GAME_ACTIONS.poolSettled: {
        const st = s.pool.get(entityTail(id, 'pool:') ?? '')
        const pick = st?.picks.find((p) => p.week === int(d.week) && p.outcome == null)
        if (!st || !pick) break
        pick.outcome = outcomeOf(d.outcome)
        pick.settledBy = d.by === 'commissioner' ? 'commissioner' : 'auto'
        const entry = rec(d.entry)
        st.entry = { alive: entry.alive !== false, revivesUsed: int(entry.revivesUsed), revivesGranted: int(entry.revivesGranted), eliminatedWeek: entry.eliminatedWeek == null ? null : int(entry.eliminatedWeek), wins: int(entry.wins) }
        break
      }
      case SIDE_GAME_ACTIONS.poolRevive:
      case SIDE_GAME_ACTIONS.poolMissed:
      case SIDE_GAME_ACTIONS.poolReviveGranted: {
        const userId = entityTail(id, 'pool:')
        if (!userId) break
        const st = s.pool.get(userId) ?? { entry: { ...EMPTY_POOL_ENTRY }, picks: [] }
        const entry = rec(d.entry)
        st.entry = { alive: entry.alive !== false, revivesUsed: int(entry.revivesUsed), revivesGranted: int(entry.revivesGranted), eliminatedWeek: entry.eliminatedWeek == null ? null : int(entry.eliminatedWeek), wins: int(entry.wins) }
        s.pool.set(userId, st)
        break
      }
      case SIDE_GAME_ACTIONS.auctionCreated: {
        const auctionId = entityTail(id, 'auction:')
        if (!auctionId) break
        const a = rec(d.auction)
        s.auctions.set(auctionId, {
          auctionId,
          label: str(a.label),
          mode: a.mode === 'open' ? 'open' : 'sealed',
          currency: a.currency === 'auction_cash' ? 'auction_cash' : 'faab',
          opensAt: str(a.opensAt),
          closesAt: str(a.closesAt),
          week: int(a.week),
          items: Array.isArray(a.items) ? (a.items as AuctionItem[]) : [],
          status: 'scheduled',
          bids: [],
          awards: [],
          cashGranted: false,
        })
        break
      }
      case SIDE_GAME_ACTIONS.auctionStatus: {
        const a = s.auctions.get(entityTail(id, 'auction:') ?? '')
        if (!a) break
        const status = str(d.status) as AuctionStatus
        if (['scheduled', 'open', 'closed', 'settled', 'cancelled'].includes(status)) a.status = status
        if (typeof d.closesAt === 'string' && d.closesAt) a.closesAt = d.closesAt
        if (d.cashGranted === true) a.cashGranted = true
        break
      }
      case SIDE_GAME_ACTIONS.auctionBid: {
        const a = s.auctions.get(entityTail(id, 'auction:') ?? '')
        if (!a) break
        const bid: AuctionBid = { itemId: str(d.itemId), rosterId: str(d.rosterId), amount: int(d.amount), at }
        // An open-auction raise replaces the bidder's earlier bid on that item.
        a.bids = a.bids.filter((b) => !(b.itemId === bid.itemId && b.rosterId === bid.rosterId))
        a.bids.push(bid)
        break
      }
      case SIDE_GAME_ACTIONS.auctionSettled: {
        const a = s.auctions.get(entityTail(id, 'auction:') ?? '')
        if (!a) break
        a.status = 'settled'
        a.awards = Array.isArray(d.awards) ? (d.awards as AuctionRecord['awards']) : []
        break
      }
      case SIDE_GAME_ACTIONS.cashCredit:
      case SIDE_GAME_ACTIONS.cashDebit: {
        const rosterId = entityTail(id, 'cash:')
        if (!rosterId) break
        const sign = row.action === SIDE_GAME_ACTIONS.cashCredit ? 1 : -1
        s.cash.set(rosterId, Math.max(0, (s.cash.get(rosterId) ?? 0) + sign * Math.max(0, int(d.amount))))
        if (typeof d.refundOf === 'string') markRefunded(s, d.refundOf)
        break
      }
      case SIDE_GAME_ACTIONS.auctionRefund: {
        if (typeof d.refundOf === 'string') markRefunded(s, d.refundOf)
        break
      }
      case SIDE_GAME_ACTIONS.shopPurchase: {
        const userId = entityTail(id, 'shop:')
        if (!userId) break
        s.purchases.push({
          purchaseId: str(d.purchaseId), userId, rosterId: str(d.rosterId) || null, itemId: str(d.itemId),
          kind: str(d.kind) as TokenShopKind, cost: int(d.cost), status: d.status === 'delivered' ? 'delivered' : 'pending',
          rewardId: str(d.rewardId) || null, at,
        })
        break
      }
      case SIDE_GAME_ACTIONS.shopDelivered: {
        const p = s.purchases.find((x) => x.purchaseId === str(d.purchaseId))
        if (p) {
          p.status = 'delivered'
          p.rewardId = str(d.rewardId) || p.rewardId
        }
        break
      }
      case SIDE_GAME_ACTIONS.exileBid: {
        const week = int(entityTail(id, 'exilebid:') ?? NaN)
        if (!week) break
        const st = s.exileBids.get(week) ?? { bids: [], resolved: null }
        const userId = str(d.userId)
        // Sealed: one bid per exile per week; a replacement before the close supersedes it.
        st.bids = st.bids.filter((b) => b.userId !== userId)
        if (int(d.amount) > 0) st.bids.push({ userId, team: str(d.team), amount: int(d.amount), at })
        s.exileBids.set(week, st)
        break
      }
      case SIDE_GAME_ACTIONS.exileBidsResolved: {
        const week = int(entityTail(id, 'exilebid:') ?? NaN)
        if (!week) break
        const st = s.exileBids.get(week) ?? { bids: [], resolved: null }
        st.resolved = Array.isArray(d.awards) ? (d.awards as Array<{ userId: string; team: string; amount: number }>) : []
        s.exileBids.set(week, st)
        break
      }
    }
  }
  return s
}

/** The item labels a viewer may see: a blind item reads "Mystery item" until the auction closes. */
export function visibleAuctionItems(a: AuctionRecord, language?: string | null): Array<Pick<AuctionItem, 'itemId' | 'blind'> & { label: string; prizeKind: string | null }> {
  const revealed = a.status === 'closed' || a.status === 'settled'
  const es = String(language ?? '').toLowerCase().startsWith('es')
  return a.items.map((i) => ({
    itemId: i.itemId,
    blind: i.blind,
    label: i.blind && !revealed ? (es ? 'Artículo misterioso' : 'Mystery item') : i.label,
    prizeKind: i.blind && !revealed ? null : i.prize.kind,
  }))
}
