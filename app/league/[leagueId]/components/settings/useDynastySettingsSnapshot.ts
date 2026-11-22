'use client'

import { useCallback, useEffect, useState } from 'react'

/** The parts of GET /api/leagues/[leagueId]/dynasty-settings the Roster tab reads. */
export type DynastySettingsSnapshot = {
  effective?: {
    taxiLockBehavior?: string
    taxiInSeasonMoves?: boolean
    taxiPostseasonMoves?: boolean
    taxiScoringOn?: boolean
    taxiPromotionDeadlineWeek?: number | null
  }
  presets?: { sportFormats?: Array<{ id: string; sport: string }> }
  sportFormatPreset?: { current: string | null; editable: boolean }
  constants?: { taxiLockBehaviorOptions?: Array<{ value: string; label: string }> }
}

/**
 * Reads the dynasty settings once for a dynasty league (no request otherwise), and exposes the one
 * write path those settings already have: PUT to the same route.
 */
export function useDynastySettingsSnapshot(leagueId: string | null | undefined, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<DynastySettingsSnapshot | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!enabled || !leagueId) {
      setSnapshot(null)
      return
    }
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/dynasty-settings`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled) setSnapshot((data as DynastySettingsSnapshot | null) ?? null) })
      .catch(() => { if (!cancelled) setSnapshot(null) })
    return () => { cancelled = true }
  }, [leagueId, enabled, reloadKey])

  const put = useCallback(
    async (body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
      if (!leagueId) return { ok: false }
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/dynasty-settings`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          return { ok: false, error: data.error }
        }
        return { ok: true }
      } catch {
        return { ok: false }
      }
    },
    [leagueId],
  )

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  return { snapshot, put, reload }
}
