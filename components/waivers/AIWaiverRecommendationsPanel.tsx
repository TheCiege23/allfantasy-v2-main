'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Sparkles } from 'lucide-react'

type Recommendation = {
  addPlayerId: string
  addPlayerName: string
  dropPlayerId: string | null
  dropPlayerName: string | null
  priority: number
  suggestedFaabBid: number | null
  confidence: 'high' | 'medium' | 'low'
  risk: 'high' | 'medium' | 'low'
  reasoning: string
  deeperAnalysisPath: string
  tags: string[]
}

type RecommendResponse = {
  ok?: boolean
  recommendations?: Recommendation[]
  generatedAt?: string
}

type LockedResponse = {
  error?: string
  message?: string
  upgradePath?: string
}

export default function AIWaiverRecommendationsPanel({ leagueId }: { leagueId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [locked, setLocked] = useState<LockedResponse | null>(null)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [remindersEnabled, setRemindersEnabled] = useState(false)

  const hasResults = recommendations.length > 0

  const summary = useMemo(() => {
    if (!hasResults) return null
    const highConfidence = recommendations.filter((r) => r.confidence === 'high').length
    return `${recommendations.length} recommendation${recommendations.length === 1 ? '' : 's'} · ${highConfidence} high-confidence`
  }, [hasResults, recommendations])

  async function loadRecommendations() {
    setLoading(true)
    setError('')
    setLocked(null)
    try {
      const response = await fetch('/api/ai/waivers/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          mode: 'quick',
          includeFaab: true,
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as RecommendResponse & LockedResponse

      if (!response.ok) {
        if (payload?.error === 'AF_PRO_REQUIRED') {
          setLocked(payload)
          setRecommendations([])
          setGeneratedAt(null)
          return
        }
        setError(payload?.message || payload?.error || "Chimmy's waiver recommendations could not load.")
        return
      }

      setRecommendations(Array.isArray(payload.recommendations) ? payload.recommendations : [])
      setGeneratedAt(payload.generatedAt ?? null)
    } catch {
      setError("Network error while loading Chimmy's waiver recommendations.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-xl border border-sky-400/25 bg-sky-500/5 p-4" data-testid="ai-waiver-recommendations-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-sky-100">Chimmy&apos;s Waiver Recommendations</h2>
          <p className="mt-1 text-xs text-white/65">
            Recommendation-only guidance for add/drop targets, FAAB bids, and risk-aware priorities.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadRecommendations()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-100 hover:bg-sky-500/20 disabled:opacity-50"
          data-testid="ai-waiver-recommendations-load"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {loading ? 'Analyzing...' : hasResults ? "Refresh Chimmy's suggestions" : "Get Chimmy's suggestions"}
        </button>
      </div>

      {locked?.error === 'AF_PRO_REQUIRED' && (
        <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3" data-testid="ai-waiver-recommendations-locked">
          <p className="text-sm font-medium text-amber-100">Chimmy&apos;s waiver recommendations are an AF Pro feature.</p>
          <p className="mt-1 text-xs text-amber-100/85">
            Unlock AF Pro to get add/drop suggestions, FAAB bids, roster-fit analysis, and waiver deadline reminders.
          </p>
          <Link
            href={locked.upgradePath || '/pricing?plan=af-pro&feature=waiver-ai'}
            className="mt-2 inline-flex rounded-md border border-amber-300/40 bg-amber-500/20 px-2.5 py-1 text-xs text-amber-100 hover:bg-amber-500/30"
            data-testid="ai-waiver-recommendations-upgrade-link"
          >
            Unlock AF Pro
          </Link>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200" data-testid="ai-waiver-recommendations-error">
          {error}
        </p>
      )}

      {hasResults && (
        <div className="mt-3 space-y-3" data-testid="ai-waiver-recommendations-results">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/60">
            <span>{summary}</span>
            {generatedAt ? <span>Updated: {new Date(generatedAt).toLocaleString()}</span> : null}
          </div>

          <ul className="space-y-2">
            {recommendations.map((rec, index) => (
              <li
                key={`${rec.addPlayerId}-${index}`}
                className="rounded-lg border border-white/10 bg-black/25 p-3"
                data-testid={`ai-waiver-recommendation-${index + 1}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-white">
                    #{rec.priority} Add <span className="font-semibold">{rec.addPlayerName}</span>
                    {rec.dropPlayerName ? <> · Drop <span className="font-semibold">{rec.dropPlayerName}</span></> : null}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-100">Confidence: {rec.confidence}</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/80">Risk: {rec.risk}</span>
                    {rec.suggestedFaabBid != null ? (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-200">Chimmy&apos;s bid · FAAB: {rec.suggestedFaabBid}</span>
                    ) : null}
                  </div>
                </div>
                <p className="mt-2 text-xs text-white/75">{rec.reasoning}</p>
                {rec.tags?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {rec.tags.map((tag) => (
                      <span key={`${rec.addPlayerId}-${tag}`} className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-white/60">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                {rec.deeperAnalysisPath ? (
                  <Link
                    href={rec.deeperAnalysisPath}
                    className="mt-2 inline-flex rounded-md border border-cyan-400/35 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-100 hover:bg-cyan-500/20"
                    data-testid={`ai-waiver-recommendation-chimmy-${index + 1}`}
                  >
                    Ask Chimmy for deeper analysis
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="rounded-lg border border-cyan-400/25 bg-cyan-500/5 p-3" data-testid="waiver-reminder-placeholder">
            <label className="inline-flex items-center gap-2 text-xs text-cyan-100/90">
              <input
                type="checkbox"
                checked={remindersEnabled}
                onChange={(event) => setRemindersEnabled(event.target.checked)}
                className="rounded border-cyan-300/40 bg-black/30"
              />
              Waiver deadline reminders
            </label>
            <p className="mt-1 text-[11px] text-cyan-100/70">Get reminded before waivers process. (Placeholder only in this phase.)</p>
          </div>
        </div>
      )}
    </section>
  )
}
