'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ReviewCheck, TradeReview } from '@/lib/decision-os/trade/tradeReview'
import { rememberReviewId } from '@/lib/trade-review/reviewIdStore'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { tOr } from '@/lib/i18n/tInterpolate'

/**
 * COMMISSIONER REVIEW MODE (design build-order step 6): the review a commissioner sees before deciding.
 *
 * Every flag and the recommendation are computed in code on the server; the note is the AI
 * explanation layer's, validated against them. A check the data could not answer is shown as
 * "not checked", with why — never hidden, never shown as clear.
 *
 * 🛑 ADVICE, NEVER AN ACTION. This panel decides nothing. The approve / veto buttons beside it are the
 * commissioner's, and they send the `reviewId` this panel was shown (`reviewIdStore`).
 */

type ReviewResponse = {
  review: TradeReview
  sides: [string, string]
  tradeGrade: { grade: string | null; partnerGrade: string | null; gradeWithheld: string | null }
  reviewId: string | null
  explanation: { noteToLeague: string | null; headline: string; source: 'ai' | 'template' }
  actOn: { platform: string; deepLink: string | null; note: string } | null
}

/** Copy is `tradeCenter.review.recommendation.<code>` and `tradeCenter.review.check.<code>`. */
const RECOMMENDATION_TONE: Record<TradeReview['recommendation'], string> = {
  approve: 'border-emerald-400/40 text-emerald-200',
  review_with_managers: 'border-amber-400/40 text-amber-200',
  consider_veto: 'border-rose-400/40 text-rose-200',
}

const SEVERITY_TONE: Record<ReviewCheck['severity'], string> = {
  high: 'bg-rose-400/15 text-rose-200',
  medium: 'bg-amber-400/15 text-amber-200',
  low: 'bg-sky-400/15 text-sky-200',
}

export function TradeReviewPanel(props: {
  leagueId: string
  tradeId: string
  kind: 'af' | 'redraft' | 'provider'
  defaultOpen?: boolean
}) {
  const { leagueId, tradeId, kind } = props
  const { t, tInterpolate } = useOptionalLanguage()
  // A check code with no copy shows the code rather than a raw key.
  const checkLabel = (code: ReviewCheck['code']) => tOr(t, `tradeCenter.review.check.${code}`, code)
  const [open, setOpen] = useState(Boolean(props.defaultOpen))
  const [data, setData] = useState<ReviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/trades/${encodeURIComponent(tradeId)}/review?kind=${kind}&explain=1`,
        { credentials: 'include', cache: 'no-store' },
      )
      const body = (await res.json().catch(() => null)) as (ReviewResponse & { error?: string }) | null
      if (!res.ok || !body || !body.review) {
        setError(body?.error ?? t('tradeCenter.review.loadFailed'))
        return
      }
      setData(body)
      rememberReviewId(tradeId, body.reviewId)
    } catch {
      setError(t('tradeCenter.review.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [leagueId, tradeId, kind, t])

  useEffect(() => {
    if (open && !data && !loading && !error) void load()
  }, [open, data, loading, error, load])

  const rec = data
    ? {
        label: tOr(t, `tradeCenter.review.recommendation.${data.review.recommendation}`, data.review.recommendation),
        tone: RECOMMENDATION_TONE[data.review.recommendation],
      }
    : null
  const raised = data?.review.checks.filter((c) => c.status === 'raised') ?? []
  const clear = data?.review.checks.filter((c) => c.status === 'clear') ?? []
  const notChecked = data?.review.checks.filter((c) => c.status === 'not_computed') ?? []

  return (
    <div className="mt-2 rounded-lg border border-indigo-300/20 bg-indigo-400/[0.06]" data-testid="trade-review-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold text-indigo-100"
        data-testid="trade-review-toggle"
      >
        <span>{t('tradeCenter.review.toggle')}</span>
        <span className="text-indigo-200/70">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-indigo-300/15 px-3 py-2 text-[11px]">
          {loading ? <p className="text-white/50">{t('tradeCenter.review.loading')}</p> : null}
          {error ? <p className="text-rose-300">{error}</p> : null}
          {data && rec ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded border px-2 py-0.5 font-semibold ${rec.tone}`} data-testid="trade-review-recommendation">
                  {rec.label}
                </span>
                {data.tradeGrade.grade ? (
                  <span className="rounded border border-white/15 px-2 py-0.5 text-white/70" data-testid="trade-review-grade">
                    {data.sides[0]} {data.tradeGrade.grade}
                    {data.tradeGrade.partnerGrade ? ` · ${data.sides[1]} ${data.tradeGrade.partnerGrade}` : ''}
                  </span>
                ) : (
                  <span className="rounded border border-white/15 px-2 py-0.5 text-white/60">
                    {data.tradeGrade.gradeWithheld
                      ? tInterpolate('tradeCenter.review.notGradedReason', { reason: data.tradeGrade.gradeWithheld })
                      : t('tradeCenter.review.notGraded')}
                  </span>
                )}
              </div>

              {data.explanation.noteToLeague ? (
                <p className="text-white/75" data-testid="trade-review-note">{data.explanation.noteToLeague}</p>
              ) : null}

              {raised.length ? (
                <ul className="space-y-1" data-testid="trade-review-flags">
                  {raised.map((c) => (
                    <li key={c.code} className="flex gap-2">
                      <span className={`h-fit rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${SEVERITY_TONE[c.severity]}`}>
                        {checkLabel(c.code)}
                      </span>
                      <span className="text-white/75">{c.explanation}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {notChecked.length ? (
                <div className="text-[11px] text-white/50" data-testid="trade-review-not-checked">
                  <p className="font-semibold text-white/60">{t('tradeCenter.review.notChecked')}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {notChecked.map((c) => (
                      <li key={c.code}>
                        {checkLabel(c.code)}: {c.explanation}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {clear.length ? (
                <p className="text-[11px] text-white/40" data-testid="trade-review-clear">
                  {tInterpolate('tradeCenter.review.clear', { checks: clear.map((c) => checkLabel(c.code)).join(' · ') })}
                </p>
              ) : null}

              {data.actOn ? (
                <p className="text-[11px] text-amber-200/80" data-testid="trade-review-act-on">
                  {data.actOn.note}
                  {data.actOn.deepLink ? (
                    <>
                      {' '}
                      <a href={data.actOn.deepLink} target="_blank" rel="noreferrer" className="underline">
                        {tInterpolate('tradeCenter.review.openPlatform', { platform: data.actOn.platform })}
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}

              <p className="text-[11px] text-white/35">{t('tradeCenter.review.adviceOnly')}</p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
