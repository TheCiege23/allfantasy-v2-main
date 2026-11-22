'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * The AF crest's state for one league: the viewer's marks and the anonymous count per player, from
 * `/api/leagues/[leagueId]/trade-interest` (lib/league/tradeInterest.ts).
 *
 * `available` is false until the read answers, when it fails, and while the table is not migrated —
 * the Trades tab then keeps its per-browser marks, so the crest still works for the viewer.
 */
export type TradeInterestState = {
  available: boolean
  counts: Record<string, number>
  mine: ReadonlySet<string>
  toggle: (playerId: string) => void
}

export function useTradeInterest(leagueId: string): TradeInterestState {
  const [available, setAvailable] = useState(false)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [mine, setMine] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trade-interest`, { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { available?: boolean; counts?: Record<string, number>; mine?: string[] } | null) => {
        if (cancelled || !json?.available) return
        setAvailable(true)
        setCounts(json.counts ?? {})
        setMine(new Set(json.mine ?? []))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const toggle = useCallback(
    (playerId: string) => {
      const next = !mine.has(playerId)
      // Optimistic: flip the mark and the count now, settle on the server's count.
      setMine((s) => {
        const n = new Set(s)
        if (next) n.add(playerId)
        else n.delete(playerId)
        return n
      })
      setCounts((c) => ({ ...c, [playerId]: Math.max(0, (c[playerId] ?? 0) + (next ? 1 : -1)) }))
      void fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trade-interest`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, interested: next }),
      })
        .then(async (r) => {
          const json = (await r.json().catch(() => null)) as { ok?: boolean; count?: number; unavailable?: boolean } | null
          if (json?.ok && typeof json.count === 'number') {
            setCounts((c) => ({ ...c, [playerId]: json.count! }))
            return
          }
          if (json?.unavailable) setAvailable(false)
          // Roll back the optimistic flip.
          setMine((s) => {
            const n = new Set(s)
            if (next) n.delete(playerId)
            else n.add(playerId)
            return n
          })
          setCounts((c) => ({ ...c, [playerId]: Math.max(0, (c[playerId] ?? 0) + (next ? -1 : 1)) }))
        })
        .catch(() => undefined)
    },
    [leagueId, mine],
  )

  return { available, counts, mine, toggle }
}
