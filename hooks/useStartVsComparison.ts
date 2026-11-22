'use client'

import { useCallback, useState } from 'react'
import type { StartVsApiResponse, StartVsStrategyMode } from '@/lib/player-comparison-lab'

type StartVsRequestBody = {
  teamId?: string | null
  sport?: string | null
  scoringFormat?: 'ppr' | 'half_ppr' | 'non_ppr' | null
  leagueScoringSettings?: Record<string, unknown> | null
  weekOrPeriod?: string | null
  playerA: string
  playerB: string
  lineupSlot?: string | null
  opponent?: string | null
  strategyMode: StartVsStrategyMode
  includeAIExplanation?: boolean
  screenshotContext?: { notes?: string | null; extractedNames?: string[] | null } | null
  /** Median tie-break only (server-side) */
  userPreference?: 'playerA' | 'playerB' | null
}

type StartVsHookResult = StartVsApiResponse & {
  leagueId: string
  explanationGate?: {
    requiredPlan: string | null
    message: string
    upgradePath: string
  } | null
}

export function useStartVsComparison() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<StartVsHookResult | null>(null)

  const reset = useCallback(() => {
    setData(null)
    setError(null)
  }, [])

  const run = useCallback(async (leagueId: string, body: StartVsRequestBody) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/player-comparison/start-vs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as StartVsHookResult & { error?: string }
      if (!res.ok) {
        throw new Error(json.error || 'Start vs comparison failed')
      }
      setData(json)
      return json
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Start vs comparison failed'
      setError(msg)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return { loading, error, data, run, reset }
}
