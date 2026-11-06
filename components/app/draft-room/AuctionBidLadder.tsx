'use client'

import { useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { auctionBidLadderMessages } from '@/lib/core-app/messages/auctionBidLadder'
import type { AuctionBidRow } from '@/lib/draft-room/auctionBidLadder'

/**
 * One player's bids — team, amount, time — newest first. Renders NOTHING for an empty list: no
 * history yet, a failed read and a table that does not exist yet all look the same, and none of
 * them earns an empty box.
 */
export function AuctionBidLadder({
  bids,
  playerName,
  nameOf,
  testId = 'auction-bid-ladder',
}: {
  /** Already filtered to one player and sorted newest first (`ladderFor`). */
  bids: readonly AuctionBidRow[]
  playerName: string
  nameOf: (rosterId: string) => string
  testId?: string
}) {
  const m = useMessages(auctionBidLadderMessages)
  if (bids.length === 0) return null
  const time = (iso: string) => {
    const at = new Date(iso)
    return Number.isNaN(at.getTime())
      ? ''
      : at.toLocaleTimeString(m.timeLocale, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  }
  return (
    <ol className="af-dr-ladder" aria-label={m.aria(playerName)} data-testid={testId}>
      {bids.map((bid, i) => (
        <li key={bid.id} className="af-dr-ladder-row" data-top={i === 0 ? 'true' : undefined} data-testid="auction-bid-rung">
          <span className="af-dr-ladder-team">{nameOf(bid.rosterId)}</span>
          <span className="af-dr-num af-dr-ladder-amt">${bid.amount}</span>
          <time className="af-dr-num af-dr-ladder-time" dateTime={bid.createdAt}>
            {time(bid.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  )
}

/**
 * The league's current auction bid history, refetched whenever `refreshKey` changes (a new bid, a
 * new nomination, a sale). `[]` on any failure, and while there is no league id (nothing to read).
 */
export function useAuctionBidHistory(leagueId: string | null | undefined, refreshKey: string): AuctionBidRow[] {
  const [bids, setBids] = useState<AuctionBidRow[]>([])
  useEffect(() => {
    if (!leagueId) {
      setBids([])
      return
    }
    let live = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/auction/bids`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { bids?: unknown } | null) => {
        if (!live) return
        setBids(Array.isArray(data?.bids) ? (data!.bids as AuctionBidRow[]) : [])
      })
      .catch(() => {
        if (live) setBids([])
      })
    return () => {
      live = false
    }
  }, [leagueId, refreshKey])
  return bids
}
