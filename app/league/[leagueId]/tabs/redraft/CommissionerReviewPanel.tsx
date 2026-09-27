'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchCommissionerTradeReview, type CommissionerTradeReview } from '@/lib/redraft/client'

function flagLabel(flag: string): string {
  return flag.toLowerCase().replace(/_/g, ' ')
}

/**
 * T4 commissioner-only trade review panel. Deterministic, non-accusatory. Lazy-fetches the
 * commissioner-review endpoint (which itself enforces commissioner gating) when expanded.
 */
export function CommissionerReviewPanel({ proposalId }: { proposalId: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<CommissionerTradeReview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchCommissionerTradeReview(proposalId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load review')
    } finally {
      setLoading(false)
    }
  }, [proposalId])

  useEffect(() => {
    if (open && !data && !loading) void load()
  }, [open, data, loading, load])

  return (
    <div className="mt-2 rounded-lg border border-indigo-300/20 bg-indigo-400/[0.06]" data-testid="commissioner-review-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="commissioner-review-toggle"
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold text-indigo-100"
      >
        <span>Commissioner Review</span>
        <span className="text-indigo-200/70">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-indigo-300/15 px-3 py-2 text-[11px]">
          {loading ? (
            <p className="text-white/50">Loading review…</p>
          ) : error ? (
            <p className="text-rose-300">{error}</p>
          ) : data ? (
            <>
              <div className="flex flex-wrap gap-2 text-[10px] text-white/70">
                {/*
                  The one grade, from the proposer's side. The snapshot's fairness and confidence are
                  priced on another scale and could contradict this letter, so they are not shown.
                */}
                {data.tradeGrade?.grade ? (
                  <span className="rounded border border-white/15 px-2 py-0.5" data-testid="commissioner-review-grade">
                    Proposer {data.tradeGrade.grade}{data.tradeGrade.partnerGrade ? ` · Receiver ${data.tradeGrade.partnerGrade}` : ''}
                  </span>
                ) : (
                  <span className="rounded border border-white/15 px-2 py-0.5" data-testid="commissioner-review-grade">
                    Not graded{data.tradeGrade?.gradeWithheld ? `: ${data.tradeGrade.gradeWithheld}` : ''}
                  </span>
                )}
                <span
                  className={`rounded border px-2 py-0.5 ${data.review.summary.reviewRecommended ? 'border-amber-400/40 text-amber-200' : 'border-emerald-400/30 text-emerald-200'}`}
                  data-testid="commissioner-review-recommended"
                >
                  {data.review.summary.reviewRecommended ? 'Manual review suggested' : 'No review flag'}
                </span>
              </div>

              {data.review.notes.length ? (
                <ul className="space-y-0.5 text-white/75">
                  {data.review.notes.map((n, i) => (
                    <li key={i}>• {n}</li>
                  ))}
                </ul>
              ) : null}

              {(data.review.riskFlags.length || data.review.contextFlags.length) ? (
                <div className="flex flex-wrap gap-1">
                  {data.review.riskFlags.map((f) => (
                    <span key={f} className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-200/80">{flagLabel(f)}</span>
                  ))}
                  {data.review.contextFlags.map((f) => (
                    <span key={f} className="rounded bg-sky-400/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-sky-200/80">{flagLabel(f)}</span>
                  ))}
                </div>
              ) : null}

              <div className="rounded border border-white/10 bg-black/20 p-2 text-[10px] text-white/60">
                <p className="font-semibold text-white/70">AllFantasy market context</p>
                {data.review.marketContext.sampleSize > 0 ? (
                  <p className="mt-0.5">
                    {data.review.marketContext.sampleSize} comparable trades · avg fairness {data.review.marketContext.averageFairness} ·
                    {' '}{data.review.marketContext.acceptedCount} accepted / {data.review.marketContext.vetoedCount} vetoed
                  </p>
                ) : (
                  <p className="mt-0.5">{data.review.marketContext.message}</p>
                )}
              </div>

              <div className="text-[10px] text-white/50">
                <p className="font-semibold text-white/70">Audit trail</p>
                <p className="mt-0.5" data-testid="commissioner-review-audit-trail">
                  {data.eventTrail.length ? data.eventTrail.map((e) => e.eventType).join(' → ') : 'No events recorded'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 text-[10px] text-white/45">
                <span>Veto: {data.settings.vetoMode}</span>
                {data.settings.vetoThreshold != null ? <span>Threshold: {data.settings.vetoThreshold}</span> : null}
                <span>Window: {data.settings.reviewHours ?? 48}h</span>
                <span>Deadline: {data.settings.tradeDeadlineWeek ? `Wk ${data.settings.tradeDeadlineWeek}` : 'none'}</span>
                <span>Picks: {data.settings.draftPickTrading ? 'on' : 'off'}</span>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
