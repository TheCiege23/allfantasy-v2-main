"use client"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import React, { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import LanguageToggle from '@/components/i18n/LanguageToggle'
import { ChaosMeter } from '@/components/bracket/ChaosMeter'

type DashboardResponse = {
  ok: boolean
  tournamentId?: string
  summary?: {
    currentRank: number
    totalEntries: number
    totalPoints: number
    correctPicks: number
    totalPicks: number
    remainingPoints: number
  }
  health?: {
    alivePct: number
    teamsAlive: number
    teamsTotal: number
    maxPossiblePoints: number
    currentPoints: number
    healthScore: number
    statusLabel: string
    upside: number
    riskExposure: number
  }
  outcomes?: {
    bestPossibleFinish: number
    worstPossibleFinish: number
    likelyFinishLow: number
    likelyFinishHigh: number
  }
  uniqueness?: {
    score: number
    percentile: number
  }
}

type SimulationResponse = {
  ok: boolean
  simulations: number
  winLeagueProbability: number
  top5Probability: number
  expectedRank: number
}

type AiReview = {
  strengths: string[]
  risks: string[]
  strategyNotes: string[]
  summary: string
} | null

type StoryResponse = {
  ok: boolean
  story?: {
    narrative: string
  }
}

function BracketIntelligenceInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const entryId = searchParams?.get('entryId') || ''
  const { t } = useLanguage()

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [sim, setSim] = useState<SimulationResponse | null>(null)
  const [aiReview, setAiReview] = useState<AiReview>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [story, setStory] = useState<string | null>(null)

  useEffect(() => {
    if (!entryId) return
    setLoading(true)
    setError(null)

    // track dashboard view
    fetch('/api/analytics/insight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'bracket_dashboard_viewed',
        entry_id: entryId,
        insight_type: 'bracket_intelligence',
        placement: 'bracket_intelligence_page',
      }),
    }).catch(() => {})

    // dashboard
    fetch('/api/bracket/intelligence/dashboard', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryId }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })).catch(() => ({ ok: false, data: {} })))
      .then(({ ok, data }) => {
        if (!ok || !data?.ok) {
          setError(data?.error || t('bracket.intel.dashboard.error'))
          return
        }
        setDashboard(data)
        fetch('/api/analytics/insight', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            event: 'health_score_viewed',
            entry_id: entryId,
            insight_type: 'bracket_intelligence',
            placement: 'bracket_intelligence_page',
          }),
        }).catch(() => {})
      })
      .catch(() => {
        setError(t('bracket.intel.dashboard.error'))
      })

    // simulation projections
    fetch('/api/bracket/intelligence/simulate-entry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryId }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })).catch(() => ({ ok: false, data: {} })))
      .then(({ ok, data }) => {
        if (!ok || !data?.ok) return
        setSim({
          ok: true,
          simulations: data.simulations,
          winLeagueProbability: data.winLeagueProbability || 0,
          top5Probability: data.top5Probability || 0,
          expectedRank: data.expectedRank || 0,
        })
        fetch('/api/analytics/insight', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            event: 'simulation_projection_viewed',
            entry_id: entryId,
            insight_type: 'bracket_intelligence',
            placement: 'bracket_intelligence_page',
          }),
        }).catch(() => {})
      })
      .catch(() => {})

    // AI insights from existing review endpoint
    fetch('/api/bracket/intelligence/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryId }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })).catch(() => ({ ok: false, data: {} })))
      .then(({ ok, data }) => {
        if (!ok || !data?.ok) return
        if (data.aiReview && typeof data.aiReview === 'object') {
          setAiReview({
            strengths: Array.isArray(data.aiReview.strengths)
              ? data.aiReview.strengths
              : [],
            risks: Array.isArray(data.aiReview.risks) ? data.aiReview.risks : [],
            strategyNotes: Array.isArray(data.aiReview.strategyNotes)
              ? data.aiReview.strategyNotes
              : [],
            summary:
              typeof data.aiReview.summary === 'string'
                ? data.aiReview.summary
                : '',
          })
          fetch('/api/analytics/insight', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              event: 'ai_dashboard_insight_viewed',
              entry_id: entryId,
              insight_type: 'bracket_intelligence',
              placement: 'bracket_intelligence_page',
            }),
          }).catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false)
      })

    // Bracket narrative story (engaging summary)
    fetch('/api/bracket/intelligence/story', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryId }),
    })
      .then((res) =>
        res
          .json()
          .then((data) => ({ ok: res.ok, data }))
          .catch(() => ({ ok: false, data: {} })),
      )
      .then(({ ok, data }: { ok: boolean; data: any }) => {
        if (!ok || !data?.ok || !data.story?.narrative) return
        setStory(data.story.narrative)
      })
      .catch(() => {})
  }, [entryId, t])

  if (!entryId) {
    return (
      <main className="min-h-screen mode-readable" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-center px-4 py-16 text-center text-sm text-white/80">
          <p className="mb-3 font-semibold">{t('bracket.intel.dashboard.missingEntry')}</p>
          <Link
            href="/brackets"
            className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black shadow-sm hover:bg-gray-100"
          >
            {t('bracket.review.backToBracketHub')}
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main
      className="min-h-screen flex flex-col mode-readable"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <header className="w-full border-b border-white/10/5">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-white/75 hover:bg-white/10"
            >
              {t('bracket.review.back')}
            </button>
            <h1 className="text-sm font-semibold text-white sm:text-base">
              {t('bracket.intel.dashboard.title')}
            </h1>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-white/70 sm:text-xs">
            <LanguageToggle />
          </div>
        </div>
      </header>

      <section className="flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="max-w-2xl text-xs text-white/70 sm:text-sm">
              {t('bracket.intel.dashboard.subtitle')}
            </p>
            {dashboard?.summary && (
              <div className="w-full max-w-xs">
                <ChaosMeter tournamentId={dashboard.tournamentId || ''} />
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-[11px] text-red-100">
              {error}
            </div>
          )}

          {/* Summary row */}
          {dashboard?.summary && (
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="mode-panel rounded-xl p-3">
                <div className="text-[11px] text-white/60">
                  {t('bracket.intel.dashboard.summary.rank')}
                </div>
                <div className="mt-1 text-lg font-semibold text-white">
                  {dashboard.summary.currentRank}
                  <span className="text-xs text-white/50">
                    {" "}
                    / {dashboard.summary.totalEntries || 0}
                  </span>
                </div>
              </div>
              <div className="mode-panel rounded-xl p-3">
                <div className="text-[11px] text-white/60">
                  {t('bracket.intel.dashboard.summary.points')}
                </div>
                <div className="mt-1 text-lg font-semibold text-white">
                  {dashboard.summary.totalPoints}
                </div>
              </div>
              <div className="mode-panel rounded-xl p-3">
                <div className="text-[11px] text-white/60">
                  {t('bracket.intel.dashboard.summary.correct')}
                </div>
                <div className="mt-1 text-lg font-semibold text-white">
                  {dashboard.summary.correctPicks}/{dashboard.summary.totalPicks}
                </div>
              </div>
              <div className="mode-panel rounded-xl p-3">
                <div className="text-[11px] text-white/60">
                  {t('bracket.intel.dashboard.summary.remaining')}
                </div>
                <div className="mt-1 text-lg font-semibold text-white">
                  {dashboard.summary.remainingPoints}
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Bracket health */}
            {dashboard?.health && (
              <div className="rounded-2xl border border-white/12 bg-white/5 p-4 space-y-2 mode-panel-soft">
                <div className="text-xs font-semibold text-white/80">
                  {t('bracket.intel.dashboard.health.title')}
                </div>
                <div className="text-2xl font-semibold text-white">
                  {dashboard.health.healthScore}/100
                </div>
                <p className="text-[11px] text-white/65">
                  {t(`bracket.intel.dashboard.health.status.${dashboard.health.statusLabel}`)}
                </p>
              </div>
            )}

            {/* Outcome range */}
            {dashboard?.outcomes && (
              <div className="rounded-2xl border border-white/12 bg-white/5 p-4 space-y-2 mode-panel-soft">
                <div className="text-xs font-semibold text-white/80">
                  {t('bracket.intel.dashboard.outcomes.title')}
                </div>
                <p className="text-[11px] text-white/75">
                  {t('bracket.intel.dashboard.outcomes.best')}:{" "}
                  <span className="font-semibold text-white">
                    #{dashboard.outcomes.bestPossibleFinish}
                  </span>
                </p>
                <p className="text-[11px] text-white/75">
                  {t('bracket.intel.dashboard.outcomes.worst')}:{" "}
                  <span className="font-semibold text-white">
                    #{dashboard.outcomes.worstPossibleFinish}
                  </span>
                </p>
                <p className="text-[11px] text-white/75">
                  {t('bracket.intel.dashboard.outcomes.likely')}:{" "}
                  <span className="font-semibold text-white">
                    #{dashboard.outcomes.likelyFinishLow}–#{dashboard.outcomes.likelyFinishHigh}
                  </span>
                </p>
              </div>
            )}

            {/* Narrative card */}
            {story && (
              <div className="rounded-2xl border border-white/12 bg-white/5 p-4 space-y-2 mode-panel-soft">
                <div className="text-xs font-semibold text-white/80">
                  {t('bracket.intel.dashboard.ai.title')}
                </div>
                <p className="text-[11px] text-white/80">
                  {story}
                </p>
              </div>
            )}

            {/* Compact uniqueness card */}
            {dashboard?.uniqueness && (
              <div className="rounded-2xl border border-purple-400/30 bg-purple-500/10 p-4 space-y-2 mode-panel-soft">
                <div className="text-xs font-semibold text-white/85">
                  {t('bracket.intel.dashboard.uniqueness.title')}
                </div>
                <div className="flex items-baseline gap-2">
                  <div className="text-2xl font-semibold text-white">
                    {Math.round(dashboard.uniqueness.score)}
                  </div>
                  <div className="text-[11px] text-white/65">
                    {t('bracket.intel.dashboard.uniqueness.scoreLabel')}
                  </div>
                </div>
                <p className="text-[11px] text-white/75">
                  <span className="text-white/60">
                    {t('bracket.intel.dashboard.uniqueness.percentile')}{" "}
                  </span>
                  <span>
                    {Math.round(dashboard.uniqueness.percentile)}%
                  </span>
                </p>
                <p className="text-[11px] text-white/70">
                  {t('bracket.intel.dashboard.uniqueness.helper')}
                </p>
              </div>
            )}

            {/* League win probabilities */}
            {sim && (
              <div className="rounded-2xl border border-white/12 bg-white/5 p-4 space-y-2 mode-panel-soft">
                <div className="text-xs font-semibold text-white/80">
                  {t('bracket.intel.dashboard.simulation.title')}
                </div>
                <p className="text-[11px] text-white/75">
                  {t('bracket.intel.dashboard.simulation.win')}{" "}
                  <span className="font-semibold text-white">
                    {Math.round(sim.winLeagueProbability * 1000) / 10}%
                  </span>
                </p>
                <p className="text-[11px] text-white/75">
                  {t('bracket.intel.dashboard.simulation.top3')}{" "}
                  <span className="font-semibold text-white">
                    {Math.round(sim.top5Probability * 800) / 10}%
                  </span>
                </p>
                <p className="text-[11px] text-white/75">
                  {t('bracket.intel.dashboard.simulation.top10')}{" "}
                  <span className="font-semibold text-white">
                    {Math.round(Math.min(1, sim.top5Probability + 0.15) * 1000) / 10}%
                  </span>
                </p>
                <p className="mt-1 text-[10px] text-white/45">
                  {t('bracket.intel.simulate.note')}
                </p>
              </div>
            )}
          </div>

          {/* AI insights */}
          {aiReview && (
            <div className="rounded-2xl border border-white/12 bg-white/5 p-4 space-y-2 mode-panel-soft">
              <div className="text-xs font-semibold text-white/80">
                {t('bracket.intel.dashboard.ai.title')}
              </div>
              {aiReview.summary && (
                <p className="text-[11px] text-white/80">{aiReview.summary}</p>
              )}
              {aiReview.strengths.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-emerald-300">
                    {t('bracket.intel.review.strengths')}
                  </div>
                  <ul className="mt-0.5 list-disc pl-4 space-y-0.5 text-[11px] text-white/80">
                    {aiReview.strengths.slice(0, 3).map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {aiReview.risks.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-amber-300">
                    {t('bracket.intel.review.risks')}
                  </div>
                  <ul className="mt-0.5 list-disc pl-4 space-y-0.5 text-[11px] text-white/80">
                    {aiReview.risks.slice(0, 3).map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {aiReview.strategyNotes.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-sky-300">
                    {t('bracket.intel.review.strategy')}
                  </div>
                  <ul className="mt-0.5 list-disc pl-4 space-y-0.5 text-[11px] text-white/80">
                    {aiReview.strategyNotes.slice(0, 3).map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-1 text-[10px] text-white/45">
                {t('bracket.intel.review.note')}
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

export default function BracketIntelligencePage() {
  return (
    <Suspense fallback={<main className="min-h-screen mode-readable" />}>
      <BracketIntelligenceInner />
    </Suspense>
  )
}

