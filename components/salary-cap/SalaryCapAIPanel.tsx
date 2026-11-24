'use client'

import { formatCapMoney } from '@/lib/salary-cap/capMoney'
import { useState, useCallback } from 'react'
import { Sparkles, ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import type { SalaryCapSummary } from './types'
import { FeatureGate } from '@/components/subscription/FeatureGate'
import { useAfSubGate } from '@/hooks/useAfSubGate'

export type SalaryCapAIPanelType =
  | 'startup_auction'
  | 'cap_health'
  | 'extension_tag'
  | 'trade_cap'
  | 'bestball'
  | 'offseason_planning'
  | 'orphan_takeover'

const TYPE_LABELS: Record<SalaryCapAIPanelType, string> = {
  startup_auction: 'Startup auction',
  cap_health: 'Cap health review',
  extension_tag: 'Extension & tag',
  trade_cap: 'Trade & contend/rebuild',
  bestball: 'Best ball roster',
  offseason_planning: 'Offseason & planning',
  orphan_takeover: 'Orphan takeover',
}

export function SalaryCapAIPanel({
  summary,
  leagueId,
  onBack,
}: {
  summary: SalaryCapSummary
  leagueId: string
  /** Absent inside the league workspace, whose sidebar already navigates (SalaryCapHome `shellNav`). */
  onBack?: () => void
}) {
  const [type, setType] = useState<SalaryCapAIPanelType>('cap_health')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    deterministic: unknown
    explanation: string
    type: string
  } | null>(null)
  const { handleApiResponse } = useAfSubGate('commissioner_cap_advice')

  const runAI = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/salary-cap/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
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
  }, [handleApiResponse, leagueId, type])

  return (
    <div className="space-y-6">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-[var(--text2)] hover:text-[var(--text)]"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      ) : null}

      <section className="rounded-2xl border border-[var(--accent-line)] bg-[var(--accent-soft)] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-[var(--accent)]">
          <Sparkles className="h-5 w-5" />
          Chimmy Salary Cap Tools
        </h2>

        <p className="mb-4 text-sm text-[var(--text)]">
          Chimmy gives strategy and advice. Your cap numbers come straight from the league.
        </p>

        {/* Deterministic data first */}
        <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--surface2)] p-3">
          <p className="mb-2 text-xs font-semibold text-[var(--muted)]">Your cap right now</p>
          <ul className="space-y-1 text-sm text-[var(--text)]">
            <li>Cap space: {formatCapMoney(summary.ledger?.capSpace ?? 0)}</li>
            <li>Committed: {formatCapMoney(summary.ledger?.totalCapHit ?? 0)} · Dead money: {formatCapMoney(summary.deadMoneyTotal)}</li>
            <li>Active contracts: {summary.contracts.length}</li>
            <li>Expiring: {summary.expiringCount} · Extension candidates: {summary.extensionCandidatesCount}</li>
            <li>Future years: {summary.futureProjection.length}</li>
          </ul>
        </div>

        {/* Type selector */}
        <div className="mb-4 flex flex-wrap gap-2">
          {(Object.keys(TYPE_LABELS) as SalaryCapAIPanelType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                type === t
                  ? 'bg-cyan-700 text-[var(--text)]'
                  : 'border border-[var(--line)] bg-[var(--chip)] text-[var(--text)] hover:bg-[var(--chip)]'
              }`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        <FeatureGate featureId="salary_cap_ai" featureNameOverride="Salary Cap Chimmy" className="mt-2">
          <button
            type="button"
            onClick={runAI}
            disabled={loading}
            className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>Get Chimmy advice: {TYPE_LABELS[type]}</>
            )}
          </button>
        </FeatureGate>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--line2)] bg-[var(--warn-soft)] p-2 text-sm text-[var(--warn)]">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface2)] p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
              Chimmy explanation ({result.type.replace(/_/g, ' ')})
            </p>
            <p className="whitespace-pre-wrap text-sm text-[var(--text)]">{result.explanation}</p>
          </div>
        )}
      </section>

      <a
        href={`/league/${leagueId}?tab=Intelligence`}
        className="inline-block text-sm text-[var(--accent)] hover:underline"
      >
        More Chimmy tools (Intelligence tab) →
      </a>
    </div>
  )
}
