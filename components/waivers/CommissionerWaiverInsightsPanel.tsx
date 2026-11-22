'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, ShieldAlert } from 'lucide-react'

type InsightItem = { code?: string; message?: string; severity?: 'info' | 'warning' | 'error'; suggestion?: string }

type CommissionerInsightsResponse = {
  settingsHealth?: InsightItem[]
  suspiciousPatterns?: InsightItem[]
  fairnessWarnings?: InsightItem[]
  recommendedSettingsChanges?: InsightItem[]
}

type LockedResponse = {
  error?: string
  message?: string
  upgradePath?: string
}

export default function CommissionerWaiverInsightsPanel({ leagueId }: { leagueId: string }) {
  const [visible, setVisible] = useState(false)
  const [checkingRole, setCheckingRole] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [locked, setLocked] = useState<LockedResponse | null>(null)
  const [insights, setInsights] = useState<CommissionerInsightsResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch(`/api/commissioner/leagues/${leagueId}/waivers?type=settings`)
        if (!cancelled) setVisible(response.ok)
      } catch {
        if (!cancelled) setVisible(false)
      } finally {
        if (!cancelled) setCheckingRole(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId])

  async function loadInsights() {
    setLoading(true)
    setError('')
    setLocked(null)
    try {
      const response = await fetch('/api/ai/waivers/commissioner-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId }),
      })

      const payload = (await response.json().catch(() => ({}))) as CommissionerInsightsResponse & LockedResponse

      if (!response.ok) {
        if (payload?.error === 'AF_COMMISSIONER_REQUIRED') {
          setLocked(payload)
          setInsights(null)
          return
        }
        setError(payload?.message || payload?.error || 'Failed to load commissioner waiver insights.')
        return
      }

      setInsights(payload)
    } catch {
      setError('Network error while loading commissioner waiver insights.')
    } finally {
      setLoading(false)
    }
  }

  if (checkingRole || !visible) return null

  return (
    <section className="rounded-xl border border-amber-400/25 bg-amber-500/5 p-4" data-testid="commissioner-waiver-insights-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-amber-100">Commissioner Chimmy Waiver Insights</h2>
          <p className="mt-1 text-xs text-white/65">
            League-wide waiver settings health and fairness diagnostics. Recommendation-only; no automatic settings changes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadInsights()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
          data-testid="commissioner-waiver-insights-load"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}
          {loading ? 'Analyzing...' : insights ? 'Refresh insights' : 'Run commissioner insights'}
        </button>
      </div>

      {locked?.error === 'AF_COMMISSIONER_REQUIRED' && (
        <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3" data-testid="commissioner-waiver-insights-locked">
          <p className="text-sm font-medium text-amber-100">League-wide Chimmy waiver tools require AF Commissioner.</p>
          <Link
            href={locked.upgradePath || '/pricing?plan=af-commissioner&feature=commissioner-waiver-ai'}
            className="mt-2 inline-flex rounded-md border border-amber-300/40 bg-amber-500/20 px-2.5 py-1 text-xs text-amber-100 hover:bg-amber-500/30"
            data-testid="commissioner-waiver-insights-upgrade-link"
          >
            Unlock AF Commissioner
          </Link>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200" data-testid="commissioner-waiver-insights-error">
          {error}
        </p>
      )}

      {insights && (
        <div className="mt-3 grid gap-3 md:grid-cols-2" data-testid="commissioner-waiver-insights-results">
          <InsightsList title="settingsHealth" items={insights.settingsHealth ?? []} />
          <InsightsList title="suspiciousPatterns" items={insights.suspiciousPatterns ?? []} />
          <InsightsList title="fairnessWarnings" items={insights.fairnessWarnings ?? []} />
          <InsightsList title="recommendedSettingsChanges" items={insights.recommendedSettingsChanges ?? []} />
        </div>
      )}
    </section>
  )
}

function InsightsList({ title, items }: { title: string; items: InsightItem[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 p-3" data-testid={`commissioner-insight-list-${title}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-white/65">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-white/45">No flags.</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-xs text-white/80">
          {items.map((item, idx) => (
            <li key={`${title}-${item.code || 'row'}-${idx}`}>
              <span className="font-medium text-white/90">{item.code || 'Insight'}:</span>{' '}
              {item.message || item.suggestion || 'No details'}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
