'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  deriveGuillotineAtmosphere,
  guillotineBannerLine,
  type GuillotineAtmosphereState,
  type GuillotineAtmosphereSummary,
} from '@/lib/guillotine/guillotineAtmosphere'

/**
 * Mood + banner line for a native guillotine league. Reads the existing guillotine summary route
 * (DB-only; the same one the stakes card and the Guillotine tab use). Until it answers, or if it
 * fails, the state is derived from the league row alone and the mood is `default`.
 */
export function useGuillotineAtmosphere({
  leagueId,
  enabled,
  predraft,
  teamCount,
  leagueWeek,
  settings,
}: {
  leagueId: string
  enabled: boolean
  predraft: boolean
  teamCount: number | null
  leagueWeek: number | null
  settings: Record<string, unknown> | null
}): (GuillotineAtmosphereState & { line: string }) | null {
  const [summary, setSummary] = useState<GuillotineAtmosphereSummary | null>(null)

  useEffect(() => {
    setSummary(null)
    if (!enabled) return
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary`, { cache: 'no-store', credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: GuillotineAtmosphereSummary | null) => {
        if (!cancelled) setSummary(payload && typeof payload === 'object' ? payload : null)
      })
      .catch(() => {
        if (!cancelled) setSummary(null)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, enabled])

  return useMemo(() => {
    if (!enabled) return null
    const state = deriveGuillotineAtmosphere({ predraft, teamCount, leagueWeek, summary, settings })
    return { ...state, line: guillotineBannerLine(state) }
  }, [enabled, predraft, teamCount, leagueWeek, summary, settings])
}
