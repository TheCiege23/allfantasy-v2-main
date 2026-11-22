'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FOCUS_REFETCH_THROTTLE_MS } from '@/lib/state-consistency/refresh-triggers'
import { addStateRefreshListener, type StateRefreshDomain } from '@/lib/state-consistency/state-events'

export type LeagueSectionResult<T = unknown> = {
  data: T | null
  /** True only while there is nothing to show yet — never during a background refetch. */
  loading: boolean
  /** True while a refetch runs behind data that is already on screen. */
  refreshing: boolean
  error: string | null
  reload: () => Promise<void>
}

/**
 * ⚠ A REFETCH MUST NOT BLANK THE TAB. This hook refetches on window focus, on tab
 * visibility and on every state-refresh event. It used to set `loading` on each of those,
 * and every consumer renders its skeleton on `loading` — so the first click after coming
 * back to the window swapped the whole tab for a skeleton and then redrew it, which read
 * as the page reloading under the click. Now `loading` is only for a section with nothing
 * to show yet (first load, or a different league/section); later fetches swap the new
 * values in place, and a failed background fetch keeps the data already on screen.
 */
export function useLeagueSectionData<T = unknown>(
  leagueId: string,
  sectionPath: string,
): LeagueSectionResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [refreshing, setRefreshing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const lastFocusRefetch = useRef(0)
  /** Which league/section the data on screen belongs to; null while nothing is shown. */
  const shownKey = useRef<string | null>(null)
  /** Only the newest request may write — a slow older response must not overwrite it. */
  const requestSeq = useRef(0)
  const sectionDomains = useMemo<StateRefreshDomain[]>(() => {
    const normalizedSection = sectionPath.toLowerCase()
    if (normalizedSection.includes('draft')) {
      return ['drafts', 'leagues', 'all']
    }
    return ['leagues', 'all']
  }, [sectionPath])

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    if (!leagueId || !sectionPath) {
      shownKey.current = null
      setData(null)
      setLoading(false)
      setRefreshing(false)
      return
    }

    const key = `${leagueId}|${sectionPath}`
    const background = shownKey.current === key
    if (background) {
      setRefreshing(true)
    } else {
      setData(null)
      setLoading(true)
      setError(null)
    }
    try {
      const res = await fetch(`/api/app/league/${encodeURIComponent(leagueId)}/${sectionPath}`, {
        cache: 'no-store',
      })

      const json = await res.json().catch(() => null)
      if (seq !== requestSeq.current) return
      if (!res.ok) {
        if (!background) {
          setError(json?.message || json?.error || `Failed to load ${sectionPath}`)
          setData(null)
        }
      } else {
        shownKey.current = key
        setError(null)
        setData(json)
      }
    } catch {
      if (seq !== requestSeq.current) return
      if (!background) {
        setError(`Failed to load ${sectionPath}`)
        setData(null)
      }
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [leagueId, sectionPath])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onForeground = () => {
      if (!leagueId || !sectionPath) return
      const now = Date.now()
      if (now - lastFocusRefetch.current < FOCUS_REFETCH_THROTTLE_MS) return
      lastFocusRefetch.current = now
      void load()
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
  }, [leagueId, load, sectionPath])

  useEffect(
    () =>
      addStateRefreshListener(sectionDomains, (detail) => {
        if (detail.leagueId && leagueId && detail.leagueId !== leagueId) return
        void load()
      }),
    [leagueId, load, sectionDomains]
  )

  return { data, loading, refreshing, error, reload: load }
}
