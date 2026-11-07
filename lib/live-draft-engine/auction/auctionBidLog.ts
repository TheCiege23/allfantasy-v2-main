import { prisma } from '@/lib/prisma'
import { logStructured } from '@/lib/logging/structured'
import { auctionBidPlayerKey, type AuctionBidRow } from '@/lib/draft-room/auctionBidLadder'

/**
 * Auction bid history — the one place that writes or reads `auction_bids` (model `AuctionBid`).
 *
 * The table comes from `prisma/migrations/20261106130000_auction_bid_history`, applied to production
 * on 2026-11-06 on the owner's instruction. The code was written to ship ahead of it, and stays that
 * way for any database that has not run it yet, where every write and read here hits P2021:
 *   - a write NEVER throws and is never on the bid's critical path: the engine has already accepted
 *     and saved the bid before this runs, and a failure here is swallowed;
 *   - a read returns `[]`, and the room renders nothing for an empty history, so a missing table
 *     looks exactly like "no history yet" — never like an error box.
 *
 * ⚠ LOGS NOTHING SENSITIVE. Only the league id and the Prisma error code — no roster ids, amounts,
 * player names or messages (a driver message can carry a connection string). A missing table is
 * logged once per process, not once per bid.
 *
 * The delegate is read structurally rather than through the generated client type so this module
 * compiles and runs against a client generated before the model existed (an undefined delegate is
 * treated like a missing table).
 */

type AuctionBidRecord = {
  id: string
  playerKey: string
  playerName: string
  rosterId: string
  amount: number
  createdAt: Date
}

type AuctionBidDelegate = {
  create(args: {
    data: {
      draftSessionId: string
      leagueId: string
      playerKey: string
      playerId: string | null
      playerName: string
      rosterId: string
      amount: number
    }
  }): Promise<unknown>
  findMany(args: {
    where: { draftSessionId: string }
    orderBy: Array<Record<string, 'asc' | 'desc'>>
    take: number
    select: Record<keyof AuctionBidRecord, true>
  }): Promise<AuctionBidRecord[]>
}

/** Enough for any real auction (rounds × teams × a few raises each) without an unbounded read. */
export const MAX_AUCTION_BIDS_READ = 2000

function delegate(): AuctionBidDelegate | null {
  return (prisma as unknown as { auctionBid?: AuctionBidDelegate }).auctionBid ?? null
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'unknown'
}

let missingLogged = false
function warn(event: string, leagueId: string, error: unknown | null) {
  const code = error == null ? 'no_delegate' : errorCode(error)
  const missing = code === 'P2021' || code === 'P2022' || code === 'no_delegate'
  if (missing) {
    if (missingLogged) return
    missingLogged = true
  }
  logStructured('warn', 'auction_bid_log', event, { leagueId, code })
}

export type RecordAuctionBidInput = {
  draftSessionId: string
  leagueId: string
  player: { playerId?: string | null; playerName: string }
  rosterId: string
  amount: number
}

/** File one accepted bid. Returns whether a row was written; never throws. */
export async function recordAuctionBid(input: RecordAuctionBidInput): Promise<boolean> {
  try {
    const bids = delegate()
    if (!bids) {
      warn('bid_log_unavailable', input.leagueId, null)
      return false
    }
    await bids.create({
      data: {
        draftSessionId: input.draftSessionId,
        leagueId: input.leagueId,
        playerKey: auctionBidPlayerKey(input.player),
        playerId: input.player.playerId?.trim() || null,
        playerName: input.player.playerName.trim(),
        rosterId: input.rosterId,
        amount: input.amount,
      },
    })
    return true
  } catch (error) {
    warn('bid_log_write_failed', input.leagueId, error)
    return false
  }
}

/** Every logged bid in a draft session, newest first. `[]` when the table is absent or the read fails. */
export async function listAuctionBids(draftSessionId: string, leagueId: string): Promise<AuctionBidRow[]> {
  try {
    const bids = delegate()
    if (!bids) return []
    const rows = await bids.findMany({
      where: { draftSessionId },
      orderBy: [{ createdAt: 'desc' }, { amount: 'desc' }],
      take: MAX_AUCTION_BIDS_READ,
      select: { id: true, playerKey: true, playerName: true, rosterId: true, amount: true, createdAt: true },
    })
    return rows.map((r) => ({
      id: r.id,
      playerKey: r.playerKey,
      playerName: r.playerName,
      rosterId: r.rosterId,
      amount: r.amount,
      createdAt: r.createdAt.toISOString(),
    }))
  } catch (error) {
    warn('bid_log_read_failed', leagueId, error)
    return []
  }
}
