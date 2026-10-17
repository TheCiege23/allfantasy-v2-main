'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import {
  AUTO_SYNC_ACCOUNT_GAP_MS,
  AUTO_SYNC_LEAGUE_GAP_MS,
  AUTO_SYNC_MAX_ROUNDS,
  AUTO_SYNC_RESUME_HIDDEN_MS,
  autoSyncDue,
  autoSyncStorageKey,
} from '@/lib/core-app/lineupAutoSync'

/**
 * Pull the user's lineups from their platforms when they open the app, come back to it, or open a
 * league — then re-render if anything moved. See lib/core-app/lineupAutoSync.ts for why and for the
 * bounds.
 *
 * Silent by design: no spinner, no error. A failure leaves the screen exactly as it was, which is
 * what it showed before this existed; the visible "Refresh my lineups" button is still there.
 */

function readStamp(key: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(key)
    return raw ? Number(raw) : null
  } catch {
    return null
  }
}

function writeStamp(key: string, at: number): void {
  try {
    window.sessionStorage.setItem(key, String(at))
  } catch {
    /* storage blocked — the server-side bounds still hold */
  }
}

type Batch = { remaining?: number; refreshed?: number }

async function runSync(leagueId: string | null): Promise<number> {
  let refreshed = 0
  for (let round = 0; round < AUTO_SYNC_MAX_ROUNDS; round++) {
    const res = await fetch('/api/core/players/refresh-lineups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(leagueId ? { leagueId } : {}),
    })
    if (!res.ok) break // 429 included: a run just happened, keep what we have
    const b = (await res.json().catch(() => ({}))) as Batch
    refreshed += b.refreshed ?? 0
    if (!b.remaining || b.remaining <= 0) break
  }
  return refreshed
}

export function useLineupAutoSync(selectedLeagueId: string | null | undefined): void {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const inFlight = useRef(false)

  // One trigger path for every moment: due by its own gap, one run at a time, re-render on change.
  const trigger = useRef(async (leagueId: string | null) => {
    if (inFlight.current) return
    const key = autoSyncStorageKey(leagueId)
    const now = Date.now()
    if (!autoSyncDue(readStamp(key), now, leagueId ? AUTO_SYNC_LEAGUE_GAP_MS : AUTO_SYNC_ACCOUNT_GAP_MS)) return
    inFlight.current = true
    writeStamp(key, now)
    try {
      const refreshed = await runSync(leagueId)
      if (refreshed > 0 && document.visibilityState === 'visible') routerRef.current.refresh()
    } catch {
      /* offline or the route failed — the screen keeps what it had */
    } finally {
      inFlight.current = false
    }
  })

  const initialLeague = useRef(selectedLeagueId ?? null)

  // Opening the app (the league on screen first, so it is current soonest), and coming back to it
  // after a real absence.
  useEffect(() => {
    void (async () => {
      if (initialLeague.current) await trigger.current(initialLeague.current)
      await trigger.current(null)
    })()
    let hiddenAt: number | null = null
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (hiddenAt != null && Date.now() - hiddenAt >= AUTO_SYNC_RESUME_HIDDEN_MS) void trigger.current(null)
      hiddenAt = null
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Opening a league: just that one, so it is current within a couple of seconds.
  useEffect(() => {
    if (!selectedLeagueId || selectedLeagueId === initialLeague.current) return
    initialLeague.current = null
    void trigger.current(selectedLeagueId)
  }, [selectedLeagueId])
}
