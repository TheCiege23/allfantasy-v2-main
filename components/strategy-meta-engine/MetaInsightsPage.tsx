'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { DEFAULT_SPORT, SUPPORTED_SPORTS, normalizeToSupportedSport } from '@/lib/sport-scope'
import type {
  DraftStrategyShift,
  MetaAnalysisResult,
  MetaInsightHeadline,
  MetaOverviewCard,
  MetaSourceCoverage,
  PositionValueChange,
  WaiverStrategyTrend,
} from '@/lib/strategy-meta-engine'

const LEAGUE_FORMATS = [
  { value: '', label: 'All formats' },
  { value: 'dynasty_sf', label: 'Dynasty SF' },
  { value: 'dynasty_1qb', label: 'Dynasty 1QB' },
  { value: 'redraft_sf', label: 'Redraft SF' },
  { value: 'redraft_1qb', label: 'Redraft 1QB' },
] as const

type TimeframeId = '24h' | '7d' | '30d'

const TIMEFRAME_OPTIONS: Array<{ value: TimeframeId; label: string }> = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

const WINDOW_DAYS_BY_TIMEFRAME: Record<TimeframeId, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
}

function formatPercent(value: number | null | undefined, digits: number = 0): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${(value * 100).toFixed(digits)}%`
}

function formatSignedPercent(value: number | null | undefined, digits: number = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const scaled = value * 100
  const prefix = scaled > 0 ? '+' : ''
  return `${prefix}${scaled.toFixed(digits)}%`
}

function formatNumber(value: number | null | undefined, digits: number = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return value.toFixed(digits)
}

function formatSignedNumber(value: number | null | undefined, digits: number = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(digits)}`
}

function formatConfidence(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${Math.round(value * 100)}%`
}

function formatGeneratedAt(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

function getRecentUsage(shift: DraftStrategyShift): number {
  return typeof shift.recentUsageRate === 'number' ? shift.recentUsageRate : shift.usageRate
}

function getBaselineUsage(shift: DraftStrategyShift): number {
  return typeof shift.baselineUsageRate === 'number' ? shift.baselineUsageRate : shift.usageRate
}

function getUsageDelta(shift: DraftStrategyShift): number {
  if (typeof shift.usageDelta === 'number') return shift.usageDelta
  return getRecentUsage(shift) - getBaselineUsage(shift)
}

function getShiftSummary(shift: DraftStrategyShift): string {
  return (
    shift.summary ??
    `${shift.strategyLabel ?? shift.strategyType} is ${String(shift.shiftLabel ?? 'stable').toLowerCase()}.`
  )
}

function getOverviewCards(data: MetaAnalysisResult): MetaOverviewCard[] {
  if (Array.isArray(data.overviewCards) && data.overviewCards.length > 0) return data.overviewCards

  const topDraft = data.draftStrategyShifts?.[0]
  const topPosition = [...(data.positionValueChanges ?? [])].sort(
    (a, b) => Math.abs((b.valueScore ?? 0)) - Math.abs((a.valueScore ?? 0))
  )[0]
  const topWaiver = data.waiverStrategyTrends?.[0]

  return [
    {
      id: 'draft',
      label: 'Draft shift',
      value: topDraft?.strategyLabel ?? topDraft?.strategyType ?? 'No signal',
      detail: topDraft
        ? `${formatPercent(getRecentUsage(topDraft))} usage | ${formatSignedPercent(getUsageDelta(topDraft))}`
        : 'Waiting for draft logs',
      tone:
        topDraft?.trendingDirection === 'Rising'
          ? 'positive'
          : topDraft?.trendingDirection === 'Falling'
            ? 'negative'
            : 'neutral',
    },
    {
      id: 'position',
      label: 'Position value',
      value: topPosition?.position ?? 'No signal',
      detail: topPosition
        ? `${topPosition.sport} | ${formatSignedNumber(topPosition.valueScore ?? 0, 0)} score`
        : 'Waiting for trade history',
      tone:
        (topPosition?.valueScore ?? 0) > 0
          ? 'positive'
          : (topPosition?.valueScore ?? 0) < 0
            ? 'negative'
            : 'neutral',
    },
    {
      id: 'waiver',
      label: 'Waiver trend',
      value: topWaiver?.primaryPosition ?? topWaiver?.sport ?? 'No signal',
      detail: topWaiver
        ? `${topWaiver.sport} | ${formatNumber(topWaiver.streamingScore ?? 0, 0)} streaming score`
        : 'Waiting for waiver history',
      tone:
        topWaiver?.trendDirection === 'Rising'
          ? 'positive'
          : topWaiver?.trendDirection === 'Falling'
            ? 'negative'
            : 'neutral',
    },
    {
      id: 'coverage',
      label: 'Coverage',
      value: `${data.sourceCoverage?.leaguesAnalyzed ?? 0} leagues`,
      detail: `${data.sourceCoverage?.draftFactCount ?? 0} draft rows | ${data.sourceCoverage?.tradeCount ?? 0} trades | ${data.sourceCoverage?.waiverTransactionCount ?? 0} waivers`,
      tone: 'neutral',
    },
  ]
}

function getHeadlines(data: MetaAnalysisResult): MetaInsightHeadline[] {
  if (Array.isArray(data.headlines) && data.headlines.length > 0) return data.headlines

  const headlines: MetaInsightHeadline[] = []
  const topDraft = data.draftStrategyShifts?.[0]
  const topPosition = data.positionValueChanges?.[0]
  const topWaiver = data.waiverStrategyTrends?.[0]

  if (topDraft) {
    headlines.push({
      id: `draft-${topDraft.strategyType}`,
      category: 'draft',
      title: topDraft.strategyLabel ?? topDraft.strategyType,
      summary: getShiftSummary(topDraft),
      confidence: topDraft.confidence ?? 0.6,
    })
  }
  if (topPosition) {
    headlines.push({
      id: `position-${topPosition.sport}-${topPosition.position}`,
      category: 'position',
      title: `${topPosition.sport} ${topPosition.position} value`,
      summary:
        topPosition.summary ??
        `${topPosition.position} is tracking ${String(topPosition.marketTrend ?? topPosition.direction ?? 'stable').toLowerCase()} in current trade sentiment.`,
      confidence: topPosition.confidence ?? 0.55,
    })
  }
  if (topWaiver) {
    headlines.push({
      id: `waiver-${topWaiver.sport}`,
      category: 'waiver',
      title: `${topWaiver.sport} waiver trend`,
      summary:
        topWaiver.summary ??
        `${topWaiver.sport} managers are leaning toward ${topWaiver.primaryPosition ?? 'mixed'} adds in this window.`,
      confidence: topWaiver.confidence ?? 0.55,
    })
  }

  return headlines
}

function getSourceCoverage(data: MetaAnalysisResult): MetaSourceCoverage {
  return (
    data.sourceCoverage ?? {
      analysisMode: 'mixed',
      windowDays: 30,
      leaguesAnalyzed: 0,
      seasonsAnalyzed: [],
      strategyReportCount: data.draftStrategyShifts?.length ?? 0,
      draftFactCount: 0,
      rosterSnapshotCount: 0,
      standingFactCount: 0,
      tradeCount: 0,
      tradeInsightCount: data.positionValueChanges?.length ?? 0,
      waiverTransactionCount: data.waiverStrategyTrends?.length ?? 0,
      waiverClaimCount: 0,
      transactionFactCount: 0,
    }
  )
}

function cardToneClasses(tone: MetaOverviewCard['tone']): string {
  if (tone === 'positive') return 'border-emerald-200 bg-emerald-50 text-emerald-950'
  if (tone === 'negative') return 'border-rose-200 bg-rose-50 text-rose-950'
  return 'border-slate-200 bg-white text-slate-950'
}

function headlineDot(category: MetaInsightHeadline['category']): string {
  if (category === 'draft') return 'bg-amber-500'
  if (category === 'position') return 'bg-sky-500'
  return 'bg-emerald-500'
}

export default function MetaInsightsPage() {
  const searchParams = useSearchParams()
  const [sport, setSport] = useState<string>(DEFAULT_SPORT)
  const [leagueFormat, setLeagueFormat] = useState<string>('')
  const [timeframe, setTimeframe] = useState<TimeframeId>('30d')
  const [data, setData] = useState<MetaAnalysisResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [showSuccessRateBars, setShowSuccessRateBars] = useState(true)
  const [activeWidgetTab, setActiveWidgetTab] = useState<'draft' | 'roster'>('draft')
  const [detailShift, setDetailShift] = useState<DraftStrategyShift | null>(null)

  useEffect(() => {
    const sportParam = searchParams?.get('sport')
    const timeframeParam = searchParams?.get('timeframe')
    const leagueFormatParam = searchParams?.get('leagueFormat')

    if (sportParam) setSport(normalizeToSupportedSport(sportParam))
    if (timeframeParam === '24h' || timeframeParam === '7d' || timeframeParam === '30d') {
      setTimeframe(timeframeParam)
    }
    if (leagueFormatParam != null) setLeagueFormat(leagueFormatParam)
  }, [searchParams])

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError(null)
      setDetailShift(null)

      const params = new URLSearchParams()
      if (sport) params.set('sport', sport)
      if (leagueFormat) params.set('leagueFormat', leagueFormat)
      params.set('timeframe', timeframe)
      params.set('windowDays', String(WINDOW_DAYS_BY_TIMEFRAME[timeframe]))

      try {
        const response = await fetch(`/api/meta-analysis?${params.toString()}`, {
          cache: 'no-store',
        })
        const payload = await response.json()
        if (!response.ok || payload?.error) {
          throw new Error(payload?.error ?? 'Failed to load meta analysis')
        }
        if (active) setData(payload)
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load meta analysis')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [leagueFormat, refreshNonce, sport, timeframe])

  const overviewCards = data ? getOverviewCards(data) : []
  const headlines = data ? getHeadlines(data) : []
  const sourceCoverage = data ? getSourceCoverage(data) : null
  const windowDays = WINDOW_DAYS_BY_TIMEFRAME[timeframe]

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <nav className="mb-5 flex flex-wrap items-center gap-3 text-sm text-slate-500">
        <Link href="/dashboard" className="hover:text-slate-900 dark:hover:text-white">
          <span aria-hidden="true">&larr;</span> App home
        </Link>
        <Link href="/app/meta-insights" className="hover:text-slate-900 dark:hover:text-white">
          Meta insights
        </Link>
        <Link href="/mock-draft-simulator" className="hover:text-slate-900 dark:hover:text-white">
          Mock draft
        </Link>
      </nav>

      <section className="rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.22),_transparent_32%),linear-gradient(135deg,_#fffdf7_0%,_#f8fafc_44%,_#eff6ff_100%)] p-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Strategy Meta Engine
            </p>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
                Strategy meta dashboard
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                Analyze draft behavior, position premiums, and waiver churn across leagues using
                league warehouse rows, draft logs, and trade history. The output stays
                deterministic so the same filters keep the same strategic story.
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-3xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur sm:grid-cols-2">
            <label className="space-y-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              <span>Sport</span>
              <select
                value={sport}
                onChange={(event) => setSport(normalizeToSupportedSport(event.target.value))}
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400"
                aria-label="Sport"
              >
                {SUPPORTED_SPORTS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              <span>League format</span>
              <select
                value={leagueFormat}
                onChange={(event) => setLeagueFormat(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400"
                aria-label="League format"
              >
                {LEAGUE_FORMATS.map((item) => (
                  <option key={item.value || 'all'} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              <span>Timeframe</span>
              <select
                value={timeframe}
                onChange={(event) => setTimeframe(event.target.value as TimeframeId)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400"
                aria-label="Timeframe"
              >
                {TIMEFRAME_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => setRefreshNonce((current) => current + 1)}
                disabled={loading}
                className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setShowSuccessRateBars((current) => !current)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-slate-300 hover:bg-slate-50"
                aria-label={showSuccessRateBars ? 'Hide success rate graph' : 'Show success rate graph'}
              >
                {showSuccessRateBars ? 'Hide success rate graph' : 'Show success rate graph'}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveWidgetTab('draft')}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              activeWidgetTab === 'draft'
                ? 'bg-slate-950 text-white'
                : 'border border-slate-200 bg-white/85 text-slate-700 hover:border-slate-300 hover:bg-white'
            }`}
          >
            Draft strategy widgets
          </button>
          <button
            type="button"
            onClick={() => setActiveWidgetTab('roster')}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              activeWidgetTab === 'roster'
                ? 'bg-slate-950 text-white'
                : 'border border-slate-200 bg-white/85 text-slate-700 hover:border-slate-300 hover:bg-white'
            }`}
          >
            Roster strategy widgets
          </button>
        </div>
      </section>

      {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}
      {loading && !data ? (
        <p className="mt-6 text-sm text-slate-500">Loading strategy meta insights...</p>
      ) : null}

      {data ? (
        <div className="mt-6 space-y-6">
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {overviewCards.map((card) => (
              <article
                key={card.id}
                className={`rounded-[24px] border p-4 shadow-sm ${cardToneClasses(card.tone)}`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">
                  {card.label}
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-tight">{card.value}</p>
                <p className="mt-2 text-sm leading-6 opacity-80">{card.detail}</p>
              </article>
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Meta headline board
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-950">
                    What the current league-wide strategy tape is saying
                  </h2>
                </div>
                <div className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600">
                  {sourceCoverage?.analysisMode ?? 'mixed'} mode
                </div>
              </div>

              {headlines.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                  No headlines yet. Expand the timeframe or warehouse coverage.
                </p>
              ) : (
                <div className="mt-5 grid gap-3">
                  {headlines.map((headline) => (
                    <article
                      key={headline.id}
                      className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-1 h-2.5 w-2.5 rounded-full ${headlineDot(headline.category)}`}
                          aria-hidden="true"
                        />
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-slate-900">{headline.title}</p>
                            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                              {headline.category}
                            </span>
                            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                              {formatConfidence(headline.confidence)} confidence
                            </span>
                          </div>
                          <p className="text-sm leading-6 text-slate-600">{headline.summary}</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <aside className="rounded-[28px] border border-slate-200 bg-slate-950 p-5 text-slate-50 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                Source coverage
              </p>
              <div className="mt-4 grid gap-3">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Leagues</p>
                  <p className="mt-2 text-2xl font-semibold">
                    {sourceCoverage?.leaguesAnalyzed ?? 0}
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    Seasons: {(sourceCoverage?.seasonsAnalyzed ?? []).join(', ') || 'none'}
                  </p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-300">
                    Warehouse rows
                  </p>
                  <p className="mt-2 text-2xl font-semibold">{sourceCoverage?.draftFactCount ?? 0}</p>
                  <p className="mt-1 text-sm text-slate-300">
                    {sourceCoverage?.tradeCount ?? 0} trades |{' '}
                    {sourceCoverage?.waiverTransactionCount ?? 0} waivers
                  </p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-300">
                    Support tables
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {sourceCoverage?.rosterSnapshotCount ?? 0}
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    {sourceCoverage?.standingFactCount ?? 0} standings |{' '}
                    {sourceCoverage?.tradeInsightCount ?? 0} trade insights
                  </p>
                </div>
              </div>
            </aside>
          </section>

          {activeWidgetTab === 'draft' ? (
            <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Draft strategy shifts</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Compare recent adoption, baseline share, and success support across the
                    current league format.
                  </p>
                </div>
                <div className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600">
                  Window: {windowDays} day{windowDays === 1 ? '' : 's'}
                </div>
              </div>

              {data.draftStrategyShifts.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                  No draft strategy reports are available for these filters yet.
                </p>
              ) : (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th className="px-3 py-3">Strategy</th>
                        <th className="px-3 py-3">Format</th>
                        <th className="px-3 py-3">Recent usage</th>
                        <th className="px-3 py-3">Baseline</th>
                        <th className="px-3 py-3">Success</th>
                        <th className="px-3 py-3">Shift</th>
                        <th className="px-3 py-3">Confidence</th>
                        <th className="px-3 py-3">N</th>
                        <th className="px-3 py-3">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.draftStrategyShifts.map((shift) => {
                        const successRate =
                          typeof shift.recentSuccessRate === 'number'
                            ? shift.recentSuccessRate
                            : shift.successRate

                        return (
                          <tr
                            key={`${shift.strategyType}-${shift.sport}-${shift.leagueFormat}`}
                            className="border-b border-slate-100 align-top"
                          >
                            <td className="px-3 py-4">
                              <div className="space-y-1">
                                <p className="font-semibold text-slate-900">
                                  {shift.strategyLabel ?? shift.strategyType}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {shift.earlyRoundFocus?.join(', ') ||
                                    'Balanced early-board approach'}
                                </p>
                              </div>
                            </td>
                            <td className="px-3 py-4 text-slate-600">{shift.leagueFormat}</td>
                            <td className="px-3 py-4 font-medium text-slate-900">
                              {formatPercent(getRecentUsage(shift))}
                            </td>
                            <td className="px-3 py-4 text-slate-600">
                              <div className="space-y-1">
                                <p>{formatPercent(getBaselineUsage(shift))}</p>
                                <p className="text-xs font-medium text-slate-500">
                                  {formatSignedPercent(getUsageDelta(shift))}
                                </p>
                              </div>
                            </td>
                            <td className="px-3 py-4">
                              <div className="space-y-2">
                                <p className="font-medium text-slate-900">
                                  {formatPercent(successRate)}
                                </p>
                                {showSuccessRateBars ? (
                                  <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                                    <div
                                      className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500"
                                      style={{
                                        width: `${Math.max(
                                          0,
                                          Math.min(100, Math.round(successRate * 100))
                                        )}%`,
                                      }}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-4">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                                  shift.trendingDirection === 'Rising'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : shift.trendingDirection === 'Falling'
                                      ? 'bg-rose-50 text-rose-700'
                                      : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {shift.shiftLabel}
                              </span>
                            </td>
                            <td className="px-3 py-4 text-slate-600">
                              {formatConfidence(shift.confidence)}
                            </td>
                            <td className="px-3 py-4 text-slate-600">{shift.sampleSize}</td>
                            <td className="px-3 py-4">
                              <button
                                type="button"
                                onClick={() =>
                                  setDetailShift((current) =>
                                    current?.strategyType === shift.strategyType &&
                                    current?.sport === shift.sport &&
                                    current?.leagueFormat === shift.leagueFormat
                                      ? null
                                      : shift
                                  )
                                }
                                className="font-medium text-sky-700 hover:text-sky-900 hover:underline"
                                aria-label={`View strategy details for ${shift.strategyType}`}
                              >
                                Details
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {detailShift ? (
                <div
                  className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-4"
                  role="dialog"
                  aria-label="Strategy details"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <p className="text-lg font-semibold text-slate-950">
                        {detailShift.strategyLabel ?? detailShift.strategyType}
                      </p>
                      <p className="text-sm leading-6 text-slate-600">
                        {getShiftSummary(detailShift)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDetailShift(null)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-100"
                      aria-label="Close strategy details"
                    >
                      Close
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <div className="rounded-3xl bg-white p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Usage</p>
                      <p className="mt-2 text-xl font-semibold text-slate-950">
                        {formatPercent(getRecentUsage(detailShift))}
                      </p>
                    </div>
                    <div className="rounded-3xl bg-white p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        Baseline
                      </p>
                      <p className="mt-2 text-xl font-semibold text-slate-950">
                        {formatPercent(getBaselineUsage(detailShift))}
                      </p>
                    </div>
                    <div className="rounded-3xl bg-white p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Delta</p>
                      <p className="mt-2 text-xl font-semibold text-slate-950">
                        {formatSignedPercent(getUsageDelta(detailShift))}
                      </p>
                    </div>
                    <div className="rounded-3xl bg-white p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        Confidence
                      </p>
                      <p className="mt-2 text-xl font-semibold text-slate-950">
                        {formatConfidence(detailShift.confidence)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-3xl bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Supporting signals
                      </p>
                      {(detailShift.supportingSignals ?? []).length > 0 ? (
                        <ul className="mt-3 space-y-2 text-sm text-slate-600">
                          {(detailShift.supportingSignals ?? []).map((signal) => (
                            <li key={signal} className="rounded-2xl bg-slate-50 px-3 py-2">
                              {signal}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 text-sm text-slate-500">
                          No additional draft signals were attached to this pattern.
                        </p>
                      )}
                    </div>

                    <div className="rounded-3xl bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Next tools
                      </p>
                      <div className="mt-3 flex flex-col gap-3 text-sm font-medium">
                        <Link
                          href={`/mock-draft-simulator?sport=${encodeURIComponent(sport)}`}
                          className="rounded-2xl bg-slate-950 px-4 py-3 text-white transition hover:bg-slate-800"
                        >
                          Open mock draft context
                        </Link>
                        <Link
                          href="/af-legacy?tab=mock-draft"
                          className="rounded-2xl border border-slate-200 px-4 py-3 text-slate-900 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          Open AF Legacy
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : (
            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">
                      Roster strategy value shifts
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      Position prices combine trade demand, draft share movement, and roster
                      pressure.
                    </p>
                  </div>
                  <div className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600">
                    {data.positionValueChanges.length} positions tracked
                  </div>
                </div>

                {data.positionValueChanges.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">
                    No position-level trade signals are available for this filter set.
                  </p>
                ) : (
                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-3 py-3">Position</th>
                          <th className="px-3 py-3">Sport</th>
                          <th className="px-3 py-3">Draft share</th>
                          <th className="px-3 py-3">Roster pressure</th>
                          <th className="px-3 py-3">Trade demand</th>
                          <th className="px-3 py-3">Value score</th>
                          <th className="px-3 py-3">Direction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.positionValueChanges.map((position: PositionValueChange) => (
                          <tr
                            key={`${position.sport}-${position.position}`}
                            className="border-b border-slate-100"
                          >
                            <td className="px-3 py-4 font-semibold text-slate-900">
                              {position.position}
                            </td>
                            <td className="px-3 py-4 text-slate-600">{position.sport}</td>
                            <td className="px-3 py-4">
                              <div className="space-y-1">
                                <p className="font-medium text-slate-900">
                                  {formatPercent(position.draftShare)}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {formatSignedPercent(position.draftShareDelta)}
                                </p>
                              </div>
                            </td>
                            <td className="px-3 py-4 text-slate-600">
                              {formatPercent(position.rosterPressure)}
                            </td>
                            <td className="px-3 py-4 text-slate-600">
                              {formatSignedNumber(position.tradeDemandScore, 1)}
                            </td>
                            <td className="px-3 py-4 font-medium text-slate-900">
                              {formatSignedNumber(position.valueScore, 0)}
                            </td>
                            <td className="px-3 py-4">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                                  (position.direction ?? position.marketTrend) === 'Rising'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : (position.direction ?? position.marketTrend) === 'Falling'
                                      ? 'bg-rose-50 text-rose-700'
                                      : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {position.direction ?? position.marketTrend ?? 'Stable'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">
                      Roster churn strategy trends
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      Waiver movement shows how aggressively managers are streaming and which
                      positions lead the churn.
                    </p>
                  </div>
                  <div className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600">
                    Last {windowDays} day{windowDays === 1 ? '' : 's'}
                  </div>
                </div>

                {data.waiverStrategyTrends.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">
                    No waiver movement was detected in this window.
                  </p>
                ) : (
                  <div className="mt-5 space-y-3">
                    {data.waiverStrategyTrends.map((waiver: WaiverStrategyTrend) => (
                      <article
                        key={waiver.sport}
                        className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-lg font-semibold text-slate-950">{waiver.sport}</p>
                            <p className="mt-1 text-sm leading-6 text-slate-600">
                              {waiver.summary ??
                                `${waiver.sport} waivers are leaning toward ${waiver.primaryPosition ?? 'mixed'} adds.`}
                            </p>
                          </div>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                              waiver.trendDirection === 'Rising'
                                ? 'bg-emerald-50 text-emerald-700'
                                : waiver.trendDirection === 'Falling'
                                  ? 'bg-rose-50 text-rose-700'
                                  : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {waiver.trendDirection ?? 'Stable'}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-3xl bg-white p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              Net adds
                            </p>
                            <p className="mt-2 text-xl font-semibold text-slate-950">
                              {waiver.netAdds}
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              {waiver.addCount} adds / {waiver.dropCount} drops
                            </p>
                          </div>
                          <div className="rounded-3xl bg-white p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              Streaming score
                            </p>
                            <p className="mt-2 text-xl font-semibold text-slate-950">
                              {formatNumber(waiver.streamingScore, 0)}
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              Top adds:{' '}
                              {(waiver.topAddPositions ?? []).join(', ') ||
                                waiver.primaryPosition ||
                                'mixed'}
                            </p>
                          </div>
                          <div className="rounded-3xl bg-white p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              Daily rate
                            </p>
                            <p className="mt-2 text-xl font-semibold text-slate-950">
                              {formatNumber(waiver.addRatePerDay, 1)} /{' '}
                              {formatNumber(waiver.dropRatePerDay, 1)}
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              Adds per day / drops per day
                            </p>
                          </div>
                          <div className="rounded-3xl bg-white p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              FAAB pressure
                            </p>
                            <p className="mt-2 text-xl font-semibold text-slate-950">
                              {formatNumber(waiver.faabAggression, 1)}
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              Confidence {formatConfidence(waiver.confidence)}
                            </p>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          <p className="text-xs text-slate-500">
            Generated at {formatGeneratedAt(data.generatedAt)}. Sources: league warehouse, draft
            logs, trade history.
          </p>
        </div>
      ) : null}
    </main>
  )
}
