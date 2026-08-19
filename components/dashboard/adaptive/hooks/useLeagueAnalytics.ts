'use client'

import { useEffect, useState } from 'react'
import { deriveAnalytics, type LeagueAnalytics, type LeagueRankingsResponse } from './deriveAnalytics'

/**
 * Real analytics for the ONE currently-selected league.
 *
 * ⚠ Single league, one request — never a per-league fan-out. This dashboard's predecessor
 * caused a production Postgres OOM (SQLSTATE 53200) by firing one analytics request per
 * league card; a real account here can hold 500+ leagues. The selected league is the only
 * thing fetched, the in-flight request is aborted when the selection changes, and results
 * are cached per league for the session so re-selecting costs nothing.
 *
 * All shaping lives in `./deriveAnalytics` (pure, tested); this hook only fetches.
 */

export type { LeagueAnalytics, PositionRow } from './deriveAnalytics'
export { positionTone } from './deriveAnalytics'

export type AnalyticsState = {
  data: LeagueAnalytics | null
  loading: boolean
  /**
   * Why there's no data, when there isn't. Distinguishes "this league genuinely has no
   * analytics" (pre-draft, unsupported platform) from "the request failed" — the UI must
   * never render a failure as an empty-but-healthy league.
   */
  unavailable: 'no-league' | 'not-supported' | 'failed' | null
}

const cache = new Map<string, LeagueAnalytics>()

export function useLeagueAnalytics(
  leagueId: string | null,
  /** Platform user id used to find "my" team among the league's rosters. */
  viewerPlatformUserId: string | null,
): AnalyticsState {
  const [state, setState] = useState<AnalyticsState>({ data: null, loading: false, unavailable: 'no-league' })

  useEffect(() => {
    if (!leagueId) {
      setState({ data: null, loading: false, unavailable: 'no-league' })
      return
    }
    const cacheKey = `${leagueId}::${viewerPlatformUserId ?? ''}`
    const cached = cache.get(cacheKey)
    if (cached) {
      setState({ data: cached, loading: false, unavailable: null })
      return
    }

    const controller = new AbortController()
    setState({ data: null, loading: true, unavailable: null })

    fetch(`/api/rankings/league-v2?leagueId=${encodeURIComponent(leagueId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((r) => {
        // 404 is the engine's "league not found or no data" — a real answer ABOUT this
        // league, not a transport failure, so it must read differently to the user.
        if (r.status === 404) return null
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<LeagueRankingsResponse>
      })
      .then((raw) => {
        if (controller.signal.aborted) return
        if (!raw) {
          setState({ data: null, loading: false, unavailable: 'not-supported' })
          return
        }
        const derived = deriveAnalytics(raw, viewerPlatformUserId)
        cache.set(cacheKey, derived)
        setState({ data: derived, loading: false, unavailable: null })
      })
      .catch((err) => {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return
        setState({ data: null, loading: false, unavailable: 'failed' })
      })

    return () => controller.abort()
  }, [leagueId, viewerPlatformUserId])

  return state
}
