'use client'

import { useEffect, useState } from 'react'
import type { FuturePicksView, ProjectedSlot } from '@/lib/league/futurePicksView'

/**
 * `/api/leagues/[leagueId]/future-picks`, shared by the Team tab and Standings so the page reads it
 * once. Null while loading or when the read fails — callers then render nothing rather than an empty
 * pick list that would look like "no picks".
 */
const cache = new Map<string, Promise<FuturePicksView | null>>()

function load(leagueId: string): Promise<FuturePicksView | null> {
  let p = cache.get(leagueId)
  if (!p) {
    p = fetch(`/api/leagues/${encodeURIComponent(leagueId)}/future-picks`, { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<FuturePicksView>) : null))
      .catch(() => null)
    cache.set(leagueId, p)
    // Let a later mount re-read rather than serve a stale answer forever.
    setTimeout(() => cache.delete(leagueId), 60_000)
  }
  return p
}

export function useFuturePicks(leagueId: string | null | undefined): FuturePicksView | null {
  const [view, setView] = useState<FuturePicksView | null>(null)
  useEffect(() => {
    if (!leagueId) return
    let cancelled = false
    void load(leagueId).then((v) => {
      if (!cancelled) setView(v)
    })
    return () => {
      cancelled = true
    }
  }, [leagueId])
  return view
}

/** A team's projected slot, matching the engine's id against either of the team's ids. */
export function projectedSlotFor(
  view: FuturePicksView,
  ids: { teamId: string | null; rosterId: string } | null | undefined,
): ProjectedSlot | null {
  if (!view.projection || !ids) return null
  return (ids.teamId ? view.projection.slots[ids.teamId] : undefined) ?? view.projection.slots[ids.rosterId] ?? null
}
