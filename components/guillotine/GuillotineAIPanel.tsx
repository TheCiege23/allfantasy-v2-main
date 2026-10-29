'use client'

import { useState, useCallback, useEffect } from 'react'
import { Sparkles, Loader2, AlertCircle } from 'lucide-react'
import { FeatureGate } from '@/components/subscription/FeatureGate'
import { useAfSubGate } from '@/hooks/useAfSubGate'

export type GuillotineAIPanelType = 'draft' | 'survival' | 'waiver' | 'recap' | 'orphan'

const TYPE_LABELS: Record<GuillotineAIPanelType, string> = {
  draft: 'Draft strategy',
  survival: 'Survival & chop-risk',
  waiver: 'Waiver aftermath',
  recap: 'Weekly recap',
  orphan: 'Orphan / AI manager',
}

export type DeterministicSummaryShape = {
  survivalStandings: { rosterId: string; displayName?: string; rank: number; seasonPointsCumul: number }[]
  dangerTiers?: { rosterId: string; displayName?: string; tier: string; pointsFromChopZone: number }[]
  choppedThisWeek: { rosterId: string; displayName?: string }[]
  recentChopEvents: { weekOrPeriod: number; choppedRosterIds: string[] }[]
}

export interface GuillotineAIPanelProps {
  leagueId: string
  weekOrPeriod?: number
  /** Pre-loaded deterministic summary (so we show data before AI). If null, panel fetches from summary API when league is guillotine. */
  deterministicSummary?: DeterministicSummaryShape | null
  defaultType?: GuillotineAIPanelType
}

export function GuillotineAIPanel({
  leagueId,
  weekOrPeriod = 1,
  deterministicSummary: deterministicSummaryProp = null,
  defaultType = 'survival',
}: GuillotineAIPanelProps) {
  const [type, setType] = useState<GuillotineAIPanelType>(defaultType)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summaryFetched, setSummaryFetched] = useState<DeterministicSummaryShape | null>(null)
  const [isGuillotineLeague, setIsGuillotineLeague] = useState<boolean | null>(null)
  const deterministicSummary = deterministicSummaryProp ?? summaryFetched

  useEffect(() => {
    if (deterministicSummaryProp != null || !leagueId) return
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary?week=${weekOrPeriod}`, {
      cache: 'no-store',
    })
      .then((res) => {
        if (cancelled) return null
        if (!res.ok) {
          setIsGuillotineLeague(false)
          return null
        }
        setIsGuillotineLeague(true)
        return res.json()
      })
      .then((data) => {
        if (cancelled || !data) return
        setSummaryFetched({
          survivalStandings: data.survivalStandings ?? [],
          dangerTiers: data.dangerTiers,
          choppedThisWeek: data.choppedThisWeek ?? [],
          recentChopEvents: data.recentChopEvents ?? [],
        })
      })
      .catch(() => {
        if (!cancelled) setIsGuillotineLeague(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, weekOrPeriod, deterministicSummaryProp])

  const [result, setResult] = useState<{
    deterministic: unknown
    explanation: string
    type: string
  } | null>(null)
  const { handleApiResponse } = useAfSubGate('commissioner_ai_tools')

  const runAI = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, week: weekOrPeriod }),
      })
      if (!(await handleApiResponse(res))) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.message ?? data.error ?? `Error ${res.status}`)
        return
      }
      setResult({
        deterministic: data.deterministic,
        explanation: data.explanation ?? '',
        type: data.type ?? type,
      })
    } catch {
      setError('Request failed')
    } finally {
      setLoading(false)
    }
  }, [handleApiResponse, leagueId, type, weekOrPeriod])

  if (deterministicSummaryProp == null && isGuillotineLeague === false) return null

  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-4 sm:p-6">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
        <Sparkles className="h-5 w-5 text-cyan-400" />
        Guilly AI
      </h2>
      <p className="mb-4 text-sm text-white/70">
        Strategy and explanation only. Elimination and standings are computed by the league engine.
      </p>

      {/* Deterministic data first */}
      {deterministicSummary && (
        <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">
            Deterministic data (from league engine)
          </p>
          <ul className="space-y-1 text-sm text-white/80">
            <li>Survival standings: {deterministicSummary.survivalStandings.length} teams</li>
            <li>Danger tiers: {deterministicSummary.dangerTiers?.length ?? 0} (Chop Zone / Danger / Safe)</li>
            <li>Chopped this week: {deterministicSummary.choppedThisWeek.length}</li>
            <li>Recent chop events: {deterministicSummary.recentChopEvents.length}</li>
          </ul>
        </div>
      )}

      {/* Type selector */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(TYPE_LABELS) as GuillotineAIPanelType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`rounded-lg px-3 py-1.5 text-sm ${type === t ? 'bg-cyan-500/80 text-white' : 'border border-white/20 bg-white/5 text-white/80 hover:bg-white/10'}`}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      <FeatureGate featureId="guillotine_ai" featureNameOverride="Guilly AI" className="mt-2">
        <button
          type="button"
          onClick={runAI}
          disabled={loading}
          className="rounded-lg bg-cyan-500/80 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>Get AI strategy: {TYPE_LABELS[type]}</>
          )}
        </button>
      </FeatureGate>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-2 text-sm text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyan-300">
            AI explanation ({result.type})
          </p>
          <p className="whitespace-pre-wrap text-sm text-white/90">{result.explanation}</p>
        </div>
      )}
    </section>
  )
}
