'use client'

/**
 * PROMPT 273 — League list with refetch on mount and window focus (throttled).
 * PROMPT 280 — Uses fetchWithRetry, getErrorMessage, logError for clean error handling.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { FOCUS_REFETCH_THROTTLE_MS } from '@/lib/state-consistency/refresh-triggers'
import { addStateRefreshListener } from '@/lib/state-consistency/state-events'
import { fetchWithRetry, getErrorMessage, logError } from '@/lib/error-handling'
import type { LeagueForGrouping } from '@/lib/dashboard'

interface UseLeagueListResult {
  leagues: LeagueForGrouping[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

function useLeagueList(enabled: boolean = true): UseLeagueListResult {
  const [leagues, setLeagues] = useState<LeagueForGrouping[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lastFocusRefetch = useRef(0)
  /*
   * ⚠ A REFETCH MUST NOT BLANK THE LIST. Focus, visibility and state events all refetch;
   * `loading` used to flip on each one, so coming back to the window swapped the list for
   * its skeleton mid-click. Once a list has loaded, later fetches update it in place and a
   * failed background fetch keeps what is on screen.
   */
  const hasLoaded = useRef(false)
  const requestSeq = useRef(0)

  const fetchList = useCallback(async () => {
    const seq = ++requestSeq.current
    if (!enabled) {
      hasLoaded.current = false
      setLeagues([])
      setLoading(false)
      return
    }
    const background = hasLoaded.current
    if (!background) {
      setLoading(true)
      setError(null)
    }
    try {
      const res = await fetchWithRetry('/api/league/list', { cache: 'no-store' }, { context: 'league-list' })
      if (seq !== requestSeq.current) return
      if (res.status === 401) {
        setLeagues([])
        return
      }
      const data = await res.json().catch(() => ({}))
      if (seq !== requestSeq.current) return
      hasLoaded.current = true
      setError(null)
      setLeagues(Array.isArray(data?.leagues) ? data.leagues : [])
    } catch (e) {
      if (seq !== requestSeq.current) return
      const err = e as Error & { status?: number }
      if (err.status === 401) {
        setLeagues([])
        return
      }
      logError(e, { context: 'useLeagueList' })
      if (background) return
      setError(getErrorMessage(e, { context: 'league-list' }))
      setLeagues([])
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  useEffect(() => {
    if (!enabled) return
    const onForeground = () => {
      const now = Date.now()
      if (now - lastFocusRefetch.current < FOCUS_REFETCH_THROTTLE_MS) return
      lastFocusRefetch.current = now
      void fetchList()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      onForeground()
    }
    window.addEventListener('focus', onForeground)
    window.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', onForeground)
      window.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, fetchList])

  useEffect(() => {
    if (!enabled) return
    return addStateRefreshListener(['leagues', 'auth', 'all'], () => void fetchList())
  }, [enabled, fetchList])

  return { leagues, loading, error, refetch: fetchList }
}
