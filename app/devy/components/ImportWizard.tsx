'use client'

import { useState } from 'react'
import { useAfSubGate } from '@/hooks/useAfSubGate'
import type { ImportAuditSummary } from '@/lib/devy/mergeExecutionEngine'
import { formatImportAuditPlainText } from '@/app/devy/lib/formatImportAuditText'
import type { SuggestedMatch } from '@/lib/devy/ai/devyChimmy'

const STEPS = [
  'Source setup',
  'Matching review',
  'Conflict resolution',
  'Pre-merge review',
  'Post-merge audit',
] as const

export function ImportWizard({ leagueId, initialSessionId }: { leagueId: string; initialSessionId?: string }) {
  const [step, setStep] = useState(0)

  return (
    <div className="flex min-h-[70dvh] flex-col">
      <div className="border-b border-white/[0.06] px-4 py-3">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(i)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                step === i ? 'bg-cyan-500/20 text-cyan-100' : 'bg-white/[0.04] text-white/45'
              }`}
              data-testid={`import-step-${i}`}
            >
              {i + 1}. {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {step === 0 ? (
          <StepSource />
        ) : step === 1 ? (
          <StepMatching />
        ) : step === 2 ? (
          <StepConflicts />
        ) : step === 3 ? (
          <StepPreMerge leagueId={leagueId} />
        ) : (
          <StepAudit leagueId={leagueId} initialSessionId={initialSessionId} />
        )}
      </div>

      <div className="sticky bottom-0 flex gap-2 border-t border-white/[0.08] bg-[#040915] p-4">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="min-h-[44px] flex-1 rounded-xl border border-white/[0.1] py-2 text-[13px] font-semibold text-white/80 disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          disabled={step >= STEPS.length - 1}
          onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          className="min-h-[44px] flex-1 rounded-xl border border-cyan-500/40 bg-cyan-500/15 py-2 text-[13px] font-semibold text-cyan-100 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}

function StepSource() {
  return (
    <div className="space-y-4 text-[13px] text-white/80">
      <div>
        <h2 className="text-[18px] font-bold text-white">Import your league history & rosters</h2>
        <p className="mt-1 text-[12px] text-white/45">Connect external platforms to combine into AllFantasy.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {['NFL roster source', 'Devy roster source', 'History source'].map((t) => (
          <button
            key={t}
            type="button"
            className="rounded-xl border border-dashed border-white/[0.12] bg-black/20 px-4 py-6 text-[12px] font-semibold text-cyan-200/80 min-h-[44px]"
          >
            + Add {t}
          </button>
        ))}
      </div>
      <div className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
        <p className="text-[11px] text-white/45">Each source: platform, connection type, classification, status.</p>
        <button
          type="button"
          className="mt-3 w-full rounded-xl border border-cyan-500/30 bg-cyan-500/10 py-3 text-[13px] font-semibold text-cyan-100 min-h-[44px]"
        >
          Run identity matching →
        </button>
      </div>
    </div>
  )
}

function StepMatching() {
  return (
    <div className="space-y-4 text-[13px] text-white/80">
      <p className="text-[12px] text-white/55">Matching players across sources…</p>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Exact', 12, 'text-emerald-300'],
          ['High', 4, 'text-sky-300'],
          ['Review', 2, 'text-amber-300'],
          ['Unmatched', 1, 'text-red-300'],
        ].map(([label, n, cls]) => (
          <div key={String(label)} className="rounded-lg border border-white/[0.06] bg-black/25 p-3 text-center">
            <p className={`text-[20px] font-bold ${cls}`}>{n}</p>
            <p className="text-[11px] uppercase text-white/45">{label}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-white/40">Review tables and actions wire to import APIs in a follow-up.</p>
    </div>
  )
}

function StepConflicts() {
  return (
    <div className="space-y-3 text-[13px] text-white/80">
      <div className="flex flex-wrap gap-2">
        {['All', 'Critical', 'Warning', 'Info'].map((f) => (
          <span
            key={f}
            className="rounded-full border border-white/[0.08] px-3 py-1 text-[11px] text-white/55"
          >
            {f}
          </span>
        ))}
      </div>
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-100">
          Duplicate
        </span>
        <p className="mt-2 text-[12px] text-white/70">Sample conflict — choose resolution (radio) + notes.</p>
        <p className="mt-2 text-[11px] text-white/40">0 of 0 resolved (placeholder)</p>
      </div>
    </div>
  )
}

function StepPreMerge({ leagueId }: { leagueId: string }) {
  return (
    <div className="space-y-4 text-[13px] text-white/80">
      <div className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
        <p className="font-semibold text-white">Merge summary</p>
        <ul className="mt-2 space-y-1 text-[12px] text-white/60">
          <li>NFL players → teams (preview)</li>
          <li>Devy prospects → teams (preview)</li>
          <li>Seasons of history</li>
          <li>Picks per team</li>
        </ul>
      </div>
      <button
        type="button"
        className="w-full rounded-xl border border-red-500/40 bg-red-500/10 py-3 text-[13px] font-semibold text-red-100 min-h-[44px]"
        onClick={() => {
          if (typeof window !== 'undefined' && window.confirm('This will overwrite empty league rosters. Continue?')) {
            /* no-op — execute route not invoked from UI-only wizard */
          }
        }}
      >
        Confirm merge →
      </button>
      <p className="text-[11px] text-white/35">League: {leagueId}</p>
    </div>
  )
}

function StepAudit({ leagueId, initialSessionId }: { leagueId: string; initialSessionId?: string }) {
  const [sessionId, setSessionId] = useState(initialSessionId ?? '')
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SuggestedMatch[] | null>(null)
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const { handleApiResponse } = useAfSubGate('commissioner_devy_scouting')

  async function downloadAudit() {
    const sid = sessionId.trim()
    if (!sid) {
      setErr('Enter the import session ID from your merge run.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch(`/api/devy/import/audit?sessionId=${encodeURIComponent(sid)}`, {
        credentials: 'include',
      })
      if (!r.ok) {
        const t = await r.text()
        throw new Error(t || `HTTP ${r.status}`)
      }
      const data = (await r.json()) as {
        audit: ImportAuditSummary
        session: { id: string; status: string; mergedAt: string | null; summary?: unknown }
      }
      const text = formatImportAuditPlainText(data.audit, data.session)
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `devy-import-audit-${sid.slice(0, 12)}.txt`
      a.rel = 'noopener'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setBusy(false)
    }
  }

  async function runSuggestMatches() {
    const sid = sessionId.trim()
    if (!sid) {
      setErr('Enter the import session ID.')
      return
    }
    setAiBusy('suggest')
    setErr(null)
    setSuggestions(null)
    try {
      const r = await fetch('/api/devy/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'suggest_matches', sessionId: sid }),
      })
      if (!(await handleApiResponse(r))) return
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      const data = (await r.json()) as { suggestions: SuggestedMatch[] }
      setSuggestions(data.suggestions ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'AI suggest failed')
    } finally {
      setAiBusy(null)
    }
  }

  async function runImportSummary() {
    const sid = sessionId.trim()
    if (!sid) {
      setErr('Enter the import session ID.')
      return
    }
    setAiBusy('summary')
    setErr(null)
    setSummaryText(null)
    try {
      const r = await fetch('/api/devy/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'import_summary', sessionId: sid }),
      })
      if (!(await handleApiResponse(r))) return
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      const data = (await r.json()) as { narrative: string; auditConfidence: string }
      setSummaryText(`${data.narrative}\n\n(Confidence: ${data.auditConfidence})`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import summary failed')
    } finally {
      setAiBusy(null)
    }
  }

  return (
    <div className="space-y-4 text-[13px] text-white/80">
      <p className="text-[16px] font-bold text-emerald-200">✓ Merge complete</p>
      <p className="text-[12px] text-white/55">
        Pulls the same audit as <code className="text-white/60">generateImportAudit</code> via{' '}
        <code className="text-white/60">GET /api/devy/import/audit</code>.
      </p>
      <label className="block text-[11px] text-white/45">
        Import session ID
        <input
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="e.g. clx…"
          className="mt-1 w-full rounded-xl border border-white/[0.1] bg-black/30 px-3 py-2 text-[13px] text-white placeholder:text-white/30 min-h-[44px]"
          data-testid="import-audit-session-input"
        />
      </label>
      {err ? <p className="text-[12px] text-red-300">{err}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          disabled={busy}
          onClick={() => void downloadAudit()}
          className="rounded-xl border border-white/[0.1] px-4 py-3 text-[12px] font-semibold text-white/90 min-h-[44px] disabled:opacity-50"
          data-testid="import-audit-download"
        >
          {busy ? 'Downloading…' : 'Download audit report (.txt)'}
        </button>
        <button
          type="button"
          disabled={!!aiBusy}
          onClick={() => void runSuggestMatches()}
          className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-3 text-[12px] font-semibold text-cyan-100 min-h-[44px] disabled:opacity-50"
          data-testid="import-ai-suggest-matches"
        >
          {aiBusy === 'suggest' ? 'Suggesting…' : 'AI suggest matches'}
        </button>
        <button
          type="button"
          disabled={!!aiBusy}
          onClick={() => void runImportSummary()}
          className="rounded-xl border border-violet-500/35 bg-violet-500/10 px-4 py-3 text-[12px] font-semibold text-violet-100 min-h-[44px] disabled:opacity-50"
          data-testid="import-ai-summary"
        >
          {aiBusy === 'summary' ? 'Summarizing…' : 'AI import summary'}
        </button>
        <a
          href={`/league/${leagueId}`}
          className="inline-flex items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-4 py-3 text-[12px] font-semibold text-cyan-100 min-h-[44px]"
          data-testid="import-audit-view-league"
        >
          View your league
        </a>
      </div>
      {suggestions && suggestions.length > 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-3 text-[11px] text-white/70">
          <p className="font-semibold text-white/85">Suggested matches</p>
          <ul className="mt-2 space-y-1">
            {suggestions.slice(0, 12).map((s) => (
              <li key={s.mappingId}>
                {s.externalName} → {s.suggestedName ?? 'No match'} ({Math.round(s.confidence)}%) — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {summaryText ? (
        <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-3 text-[12px] text-white/80 whitespace-pre-wrap">
          {summaryText}
        </div>
      ) : null}
    </div>
  )
}
