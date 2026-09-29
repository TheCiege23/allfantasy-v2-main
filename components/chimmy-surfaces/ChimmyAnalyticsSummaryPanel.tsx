'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ChimmyLearningSnapshot } from '@/lib/chimmy-actions'

interface AnalyticsResponse {
  ok: boolean
  snapshot: ChimmyLearningSnapshot
}

export interface ChimmyAnalyticsSummaryPanelProps {
  className?: string
  limit?: number
}

export default function ChimmyAnalyticsSummaryPanel({ className = '', limit = 500 }: ChimmyAnalyticsSummaryPanelProps) {
  const [snapshot, setSnapshot] = useState<ChimmyLearningSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadSummary() {
      setLoading(true)
      setError(null)
      try {
        const qs = new URLSearchParams({
          limit: String(limit),
          includeSavedRecommendations: 'true',
        })
        const response = await fetch(`/api/ai/actions/analytics/summary?${qs.toString()}`, {
          method: 'GET',
          cache: 'no-store',
        })
        const payload = (await response.json()) as AnalyticsResponse | { error?: string }

        if (!response.ok || !('ok' in payload) || payload.ok !== true) {
          if (!active) return
          setError((payload as { error?: string }).error ?? 'Failed to load analytics summary.')
          return
        }

        if (active) {
          setSnapshot(payload.snapshot)
        }
      } catch {
        if (active) setError('Unable to load analytics summary right now.')
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadSummary()
    return () => {
      active = false
    }
  }, [limit])

  const topAction = useMemo(() => snapshot?.actionMetrics[0] ?? null, [snapshot])
  const topOutcome = useMemo(() => snapshot?.measurableOutcomesByType[0] ?? null, [snapshot])

  return (
    <section className={`rounded-xl border border-white/10 bg-white/[0.02] p-3 ${className}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Learning Snapshot</p>

      {loading && <p className="mt-2 text-xs text-white/40">Loading action analytics...</p>}
      {!loading && error && <p className="mt-2 text-xs text-amber-300">{error}</p>}

      {!loading && !error && snapshot && (
        <div className="mt-2 space-y-2 text-xs text-white/70">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Shown" value={snapshot.totals.shown} />
            <Metric label="Completed" value={snapshot.totals.completed} />
            <Metric label="Followed" value={snapshot.totals.followedSuggestion} />
            <Metric label="Outcomes" value={snapshot.totals.measurableOutcomes} />
          </div>

          {topAction && (
            <p className="text-white/60">
              Top action: <span className="font-mono text-white/80">{topAction.actionType}</span>{' '}
              ({Math.round(topAction.completionRate * 100)}% completion)
            </p>
          )}

          {topOutcome && (
            <p className="text-white/60">
              Top outcome: <span className="font-mono text-white/80">{topOutcome.outcomeType}</span>{' '}
              ({topOutcome.count} events)
            </p>
          )}

          {snapshot.notes.length > 0 && (
            <p className="text-[11px] text-white/50">{snapshot.notes[0]}</p>
          )}
        </div>
      )}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
      <p className="text-[11px] uppercase tracking-wide text-white/40">{label}</p>
      <p className="font-mono text-sm text-white/80">{value}</p>
    </div>
  )
}
