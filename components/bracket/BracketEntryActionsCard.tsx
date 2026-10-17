"use client"

import { useState } from "react"
import Link from "next/link"
import { Sparkles, Copy, BarChart3, Loader2, ListChecks, Swords } from "lucide-react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { buildAIChatHref } from "@/lib/chimmy-chat"

type Props = {
  leagueId: string
  tournamentId: string
  entryId: string
}

export default function BracketEntryActionsCard({ leagueId, tournamentId, entryId }: Props) {
  const entryUrl = `/bracket/${tournamentId}/entry/${entryId}`
  const { t } = useLanguage()
  const [simLoading, setSimLoading] = useState(false)
  const [simError, setSimError] = useState<string | null>(null)
  const [simResult, setSimResult] = useState<{
    win: number
    top5: number
    expectedRank: number
  } | null>(null)

  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewResult, setReviewResult] = useState<{
    strengths: string[]
    risks: string[]
    strategyNotes: string[]
    summary: string
  } | null>(null)
  const [reviewMetrics, setReviewMetrics] = useState<{
    uniquenessScore: number | null
    uniquenessPercentile: number | null
    upsetRatePct: number | null
    championTeam: string | null
    championPopularityPct: number | null
  } | null>(null)

  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  async function submitBracket() {
    setSubmitLoading(true)
    setSubmitError(null)
    setSubmitSuccess(false)
    try {
      const res = await fetch(`/api/bracket/entries/${entryId}/submit`, {
        method: "POST",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setSubmitError(
          data?.message ||
            data?.error ||
            t("bracket.entry.submit.error"),
        )
        return
      }
      setSubmitSuccess(true)
    } catch {
      setSubmitError(t("bracket.entry.submit.error"))
    } finally {
      setSubmitLoading(false)
    }
  }

  async function runSimulation() {
    setSimLoading(true)
    setSimError(null)
    try {
      const res = await fetch("/api/bracket/intelligence/simulate-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setSimError(data?.error || t("bracket.intel.simulate.error"))
        return
      }
      const win = Math.round((data.winLeagueProbability || 0) * 1000) / 10
      const top5 = Math.round((data.top5Probability || 0) * 1000) / 10
      const expectedRank = data.expectedRank ? Math.round(data.expectedRank * 10) / 10 : 0
      setSimResult({ win, top5, expectedRank })
    } catch {
      setSimError(t("bracket.intel.simulate.error"))
    } finally {
      setSimLoading(false)
    }
  }

  async function runReview() {
    setReviewLoading(true)
    setReviewError(null)
    try {
      const res = await fetch("/api/bracket/intelligence/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setReviewError(data?.error || t("bracket.intel.review.error"))
        return
      }
      const m = data.metrics || {}
      const u = m.uniqueness || {}
      const champ = m.champion || {}
      const upsetRatePct =
        typeof m.upsetRate === "number" ? Math.round(m.upsetRate * 1000) / 10 : null
      const championPopularityPct =
        typeof champ.popularity?.pct === "number"
          ? Math.round(champ.popularity.pct * 10) / 10
          : null
      setReviewMetrics({
        uniquenessScore:
          typeof u.score === "number" && Number.isFinite(u.score) ? u.score : null,
        uniquenessPercentile:
          typeof u.percentile === "number" && Number.isFinite(u.percentile)
            ? u.percentile
            : null,
        upsetRatePct,
        championTeam: typeof champ.pick === "string" ? champ.pick : null,
        championPopularityPct,
      })
      setReviewResult({
        strengths: Array.isArray(data.aiReview?.strengths) ? data.aiReview.strengths : [],
        risks: Array.isArray(data.aiReview?.risks) ? data.aiReview.risks : [],
        strategyNotes: Array.isArray(data.aiReview?.strategyNotes)
          ? data.aiReview.strategyNotes
          : [],
        summary: typeof data.aiReview?.summary === "string" ? data.aiReview.summary : "",
      })
    } catch {
      setReviewError(t("bracket.intel.review.error"))
    } finally {
      setReviewLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <h3 className="text-sm font-semibold text-white">
        {t("bracket.intel.actions.title")}
      </h3>
      <div className="flex flex-col gap-2">
        <Link
          href={`/brackets/leagues/${leagueId}`}
          className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80 hover:bg-white/10 transition"
        >
          {t("bracket.intel.actions.backToPool")}
        </Link>
        <Link
          href={buildAIChatHref({ leagueId, source: "league_forecast" })}
          className="rounded-lg border border-cyan-400/35 px-3 py-2 text-xs text-cyan-200 hover:bg-cyan-500/20 transition inline-flex items-center gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t("bracket.intel.actions.openCoach")}
        </Link>
        <button
          onClick={() =>
            navigator.clipboard.writeText(
              typeof window !== "undefined" ? `${window.location.origin}${entryUrl}` : entryUrl,
            )
          }
          className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80 hover:bg-white/10 transition inline-flex items-center gap-1.5"
          type="button"
        >
          <Copy className="h-3.5 w-3.5" />
          {t("bracket.intel.actions.copyLink")}
        </button>

        <button
          type="button"
          onClick={submitBracket}
          disabled={submitLoading}
          className="rounded-lg border border-emerald-400/45 px-3 py-2 text-xs text-emerald-100 hover:bg-emerald-500/15 transition inline-flex items-center gap-1.5 disabled:opacity-60"
        >
          {submitLoading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("bracket.entry.submit.loading")}
            </>
          ) : (
            <>
              <ListChecks className="h-3.5 w-3.5" />
              {t("bracket.entry.submit.cta")}
            </>
          )}
        </button>

        {submitError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
            {submitError}
          </div>
        )}
        {submitSuccess && !submitError && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200">
            {t("bracket.entry.submit.success")}
          </div>
        )}

        <button
          type="button"
          onClick={() =>
            typeof window !== "undefined" &&
            (window.location.href = `/bracket-intelligence?entryId=${entryId}`)
          }
          className="rounded-lg border border-purple-400/45 px-3 py-2 text-xs text-purple-100 hover:bg-purple-500/15 transition inline-flex items-center gap-1.5"
        >
          <Swords className="h-3.5 w-3.5" />
          {t("bracket.social.intel.openDashboard")}
        </button>

        <div className="mt-2 rounded-lg border border-white/12 bg-white/5 px-3 py-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/80">
              <BarChart3 className="h-3.5 w-3.5" />
              <span>{t("bracket.intel.simulate.title")}</span>
            </div>
            <button
              type="button"
              disabled={simLoading}
              onClick={runSimulation}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-60"
            >
              {simLoading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("bracket.intel.simulate.running")}
                </>
              ) : (
                <>{t("bracket.intel.simulate.run")}</>
              )}
            </button>
          </div>

          {simError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
              {simError}
            </div>
          )}

          {simResult && !simError && (
            <div className="space-y-0.5 text-[11px] text-white/80">
              <div>
                <span className="text-white/60">
                  {t("bracket.intel.simulate.winChance")}:{" "}
                </span>
                <span>{simResult.win}%</span>
              </div>
              <div>
                <span className="text-white/60">
                  {t("bracket.intel.simulate.top5")}:{" "}
                </span>
                <span>{simResult.top5}%</span>
              </div>
              <div>
                <span className="text-white/60">
                  {t("bracket.intel.simulate.expectedRank")}:{" "}
                </span>
                <span>{simResult.expectedRank}</span>
              </div>
              <p className="mt-1 text-[11px] text-white/45">
                {t("bracket.intel.simulate.note")}
              </p>
            </div>
          )}
        </div>

        <div className="mt-2 rounded-lg border border-white/12 bg-white/5 px-3 py-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/80">
              <ListChecks className="h-3.5 w-3.5" />
              <span>{t("bracket.intel.review.title")}</span>
            </div>
            <button
              type="button"
              disabled={reviewLoading}
              onClick={runReview}
              className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/40 bg-sky-400/10 px-2.5 py-1 text-[11px] font-semibold text-sky-100 hover:bg-sky-400/20 disabled:opacity-60"
            >
              {reviewLoading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("bracket.intel.review.running")}
                </>
              ) : (
                <>{t("bracket.intel.review.run")}</>
              )}
            </button>
          </div>

          {reviewError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
              {reviewError}
            </div>
          )}

          {reviewResult && !reviewError && (
            <div className="space-y-1.5 text-[11px] text-white/80">
              {reviewMetrics && (
                <div className="space-y-0.5">
                  <div>
                    <span className="text-white/60">
                      {t("bracket.intel.review.metrics.uniqueness")}:{" "}
                    </span>
                    <span>
                      {reviewMetrics.uniquenessScore != null
                        ? reviewMetrics.uniquenessScore
                        : "—"}
                      {reviewMetrics.uniquenessPercentile != null &&
                        ` (P${reviewMetrics.uniquenessPercentile})`}
                    </span>
                  </div>
                  <div>
                    <span className="text-white/60">
                      {t("bracket.intel.review.metrics.upsetRate")}:{" "}
                    </span>
                    <span>
                      {reviewMetrics.upsetRatePct != null
                        ? `${reviewMetrics.upsetRatePct}%`
                        : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-white/60">
                      {t("bracket.intel.review.metrics.championPopularity")}:{" "}
                    </span>
                    <span>
                      {reviewMetrics.championTeam
                        ? `${reviewMetrics.championTeam}${
                            reviewMetrics.championPopularityPct != null
                              ? ` (${reviewMetrics.championPopularityPct}%)`
                              : ""
                          }`
                        : "—"}
                    </span>
                  </div>
                </div>
              )}

              {reviewResult.summary && (
                <p className="text-[11px] text-white/80">{reviewResult.summary}</p>
              )}

              {reviewResult.strengths.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-emerald-300">
                    {t("bracket.intel.review.strengths")}
                  </div>
                  <ul className="mt-0.5 list-disc pl-4 space-y-0.5">
                    {reviewResult.strengths.slice(0, 3).map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {reviewResult.risks.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-amber-300">
                    {t("bracket.intel.review.risks")}
                  </div>
                  <ul className="mt-0.5 list-disc pl-4 space-y-0.5">
                    {reviewResult.risks.slice(0, 3).map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {reviewResult.strategyNotes.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-sky-300">
                    {t("bracket.intel.review.strategy")}
                  </div>
                  <ul className="mt-0.5 list-disc pl-4 space-y-0.5">
                    {reviewResult.strategyNotes.slice(0, 3).map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="mt-1 text-[11px] text-white/45">
                {t("bracket.intel.review.note")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

