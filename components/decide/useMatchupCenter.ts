'use client'

import { useEffect, useState } from 'react'
import type { MatchupCenterPayload } from '@/lib/matchup-intel/matchupCenterService'

export type MatchupCenterResponse =
  | { supported: false; platform: string }
  | { supported: true; viewerSleeperUserId: string | null; center: MatchupCenterPayload | null; error?: string }

/*
 * ONE REQUEST PER LEAGUE FOR EVERY PANEL THAT WANTS IT — the same rule as useWaiverIntel. The
 * Decide home mounts the "This week" strip (your matchup, one line) and Matchup Center (every
 * matchup) on the same screen; the route reads Sleeper, so two fetches would be two copies of a slow
 * read that could also come back different. In-flight and settled promises are shared for a short
 * window, so a remount on navigation still refreshes.
 */
const SHARE_MS = 60_000
const inflight = new Map<string, { at: number; p: Promise<MatchupCenterResponse> }>()

export function fetchMatchupCenter(leagueId: string): Promise<MatchupCenterResponse> {
  const hit = inflight.get(leagueId)
  if (hit && Date.now() - hit.at < SHARE_MS) return hit.p
  const p = fetch(`/api/league/matchup-center?leagueId=${encodeURIComponent(leagueId)}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  })
    .then((res) => res.json() as Promise<MatchupCenterResponse>)
    .catch((): MatchupCenterResponse => ({ supported: true, viewerSleeperUserId: null, center: null, error: 'Request failed' }))
  inflight.set(leagueId, { at: Date.now(), p })
  return p
}

export function useMatchupCenter(leagueId: string): { data: MatchupCenterResponse | null; loading: boolean } {
  const [data, setData] = useState<MatchupCenterResponse | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchMatchupCenter(leagueId).then((payload) => {
      if (cancelled) return
      setData(payload)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [leagueId])
  return { data, loading }
}
