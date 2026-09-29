'use client'

/**
 * Phase 4.2 — Persisted import warnings card.
 *
 * Fetches from the existing `GET /api/leagues/[leagueId]/import/warnings` route
 * (commissioner-gated, so only the importer sees it). Renders each `ImportWarning`
 * row with color-graded severity, aligned to the Dashboard V2 color grammar
 * (positive=emerald · caution=amber · critical=red). Honest empty state — never
 * fabricates "all clean" without confirming the fetch actually returned zero rows.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Info, XCircle } from 'lucide-react'

type PersistedWarning = {
  id: string
  runId: string
  leagueId: string | null
  code: string
  message: string
  severity: 'info' | 'warn' | 'error' | string
  metadata?: unknown
  run?: {
    id?: string
    provider?: string
    status?: string
    sourceLeagueId?: string
    startedAt?: string | Date
  } | null
}

export interface ImportWarningsCardProps {
  leagueId: string
  /**
   * Called with the fetched-warning summary the moment the fetch resolves.
   * Lets the parent surface the counts elsewhere (e.g., the health indicator)
   * without a second request. Called with `null` while loading.
   */
  onSummary?: (summary: { error: number; warn: number; info: number; total: number } | null) => void
}

const SEVERITY_STYLES: Record<
  'error' | 'warn' | 'info',
  { border: string; bg: string; text: string; icon: typeof AlertTriangle; label: string }
> = {
  error: {
    border: 'border-red-500/30',
    bg: 'bg-red-500/[0.06]',
    text: 'text-red-300',
    icon: XCircle,
    label: 'Error',
  },
  warn: {
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/[0.06]',
    text: 'text-amber-300',
    icon: AlertTriangle,
    label: 'Warning',
  },
  info: {
    border: 'border-blue-500/25',
    bg: 'bg-blue-500/[0.05]',
    text: 'text-blue-300',
    icon: Info,
    label: 'Info',
  },
}

function styleFor(sev: string) {
  if (sev === 'error') return SEVERITY_STYLES.error
  if (sev === 'warn') return SEVERITY_STYLES.warn
  return SEVERITY_STYLES.info
}

export function ImportWarningsCard({ leagueId, onSummary }: ImportWarningsCardProps) {
  const [warnings, setWarnings] = useState<PersistedWarning[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/import/warnings`, {
          cache: 'no-store',
        })
        const body = (await res.json()) as { warnings?: PersistedWarning[]; error?: string }
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        if (cancelled) return
        const rows = body.warnings ?? []
        setWarnings(rows)
        onSummary?.({
          error: rows.filter((r) => r.severity === 'error').length,
          warn: rows.filter((r) => r.severity === 'warn').length,
          info: rows.filter((r) => r.severity === 'info').length,
          total: rows.length,
        })
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Could not load warnings')
        onSummary?.(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId, onSummary])

  if (loading) {
    return (
      <div
        data-testid="import-warnings-card"
        data-state="loading"
        className="warroom-card warroom-fade-in-stagger rounded-2xl border border-white/10 bg-white/[0.03] p-4"
      >
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white/40" aria-hidden />
          <p className="text-[11px] font-black uppercase tracking-wide text-white/50">Checking import health…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        data-testid="import-warnings-card"
        data-state="error"
        className="warroom-card warroom-fade-in-stagger rounded-2xl border border-red-500/25 bg-red-500/[0.06] p-4 text-sm text-red-200"
      >
        Could not load import warnings — {error}
      </div>
    )
  }

  const rows = warnings ?? []
  if (rows.length === 0) {
    return (
      <div
        data-testid="import-warnings-card"
        data-state="clean"
        className="warroom-card warroom-fade-in-stagger flex items-center gap-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]" aria-hidden />
        <p className="text-[13px] font-black uppercase tracking-wide text-emerald-300">Import clean</p>
        <p className="text-[13px] text-white/60">No warnings recorded for this run.</p>
      </div>
    )
  }

  return (
    <div
      data-testid="import-warnings-card"
      data-state="warnings"
      data-warning-count={rows.length}
      className="warroom-card warroom-fade-in-stagger overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">
          Import warnings <span className="ml-1 text-white/40">({rows.length})</span>
        </p>
        <p className="text-[11px] text-white/40">
          {rows[0]?.run?.provider ? `via ${rows[0].run.provider}` : ''}
        </p>
      </div>
      <ul className="divide-y divide-white/[0.05]">
        {rows.slice(0, 10).map((w) => {
          const s = styleFor(w.severity)
          const Icon = s.icon
          return (
            <li key={w.id} className={`flex items-start gap-3 border-l-2 ${s.border} px-4 py-3`}>
              <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${s.bg}`}>
                <Icon className={`h-3.5 w-3.5 ${s.text}`} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-black uppercase tracking-wider ${s.text}`}>{s.label}</span>
                  <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-white/60">
                    {w.code}
                  </code>
                </div>
                <p className="mt-1 text-[13px] leading-snug text-white/80">{w.message}</p>
              </div>
            </li>
          )
        })}
      </ul>
      {rows.length > 10 ? (
        <p className="border-t border-white/[0.05] px-4 py-2 text-center text-[11px] text-white/40">
          Showing 10 of {rows.length} · Older warnings persist for audit.
        </p>
      ) : null}
    </div>
  )
}
