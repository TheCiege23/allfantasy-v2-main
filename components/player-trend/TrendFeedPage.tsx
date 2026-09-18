'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  DEFAULT_SPORT,
  SUPPORTED_SPORTS,
  isSupportedSport,
  normalizeToSupportedSport,
} from '@/lib/sport-scope'
import type {
  TrendAIInsight,
  TrendDeterministicSignals,
  TrendFeedItem,
  TrendFeedType,
  TrendSignalSnapshot,
  TrendSummary,
} from '@/lib/player-trend/types'

type TimeframeId = '24h' | '7d' | '30d'

const TIMEFRAME_OPTIONS: ReadonlyArray<{ value: TimeframeId; label: string }> = [
  { value: '24h', label: '24h window' },
  { value: '7d', label: '7d window' },
  { value: '30d', label: '30d window' },
]

const TREND_LABELS: Record<TrendFeedType, string> = {
  hot_streak: 'Hot streak',
  cold_streak: 'Cold streak',
  breakout_candidate: 'Breakout candidate',
  sell_high_candidate: 'Sell-high candidate',
}

const TREND_COLORS: Record<TrendFeedType, string> = {
  hot_streak: 'border-amber-300/80 bg-amber-100/80 text-amber-900',
  cold_streak: 'border-slate-300/80 bg-slate-100/80 text-slate-800',
  breakout_candidate: 'border-emerald-300/80 bg-emerald-100/80 text-emerald-900',
  sell_high_candidate: 'border-rose-300/80 bg-rose-100/80 text-rose-900',
}

const DEFAULT_SNAPSHOT: TrendSignalSnapshot = {
  dataSource: 'trend_baseline',
  recentGamesSample: 0,
  priorGamesSample: 0,
  recentFantasyPointsAvg: null,
  priorFantasyPointsAvg: null,
  recentUsageValue: null,
  priorUsageValue: null,
  recentMinutesOrShare: null,
  priorMinutesOrShare: null,
  recentEfficiency: null,
  priorEfficiency: null,
  expectedFantasyPointsPerGame: null,
  seasonFantasyPointsPerGame: null,
  expectedGap: null,
  weeklyVolatility: null,
  breakoutRating: null,
  currentAdpTrend: null,
}

const DEFAULT_SIGNALS: TrendDeterministicSignals = {
  performanceDelta: null,
  usageChange: 0,
  minutesOrSnapShare: 0,
  efficiencyScore: 0,
  volumeChange: null,
  efficiencyDelta: null,
  confidence: 0.35,
  signalStrength: 0,
}

function formatSigned(value: number | null | undefined, digits: number = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
}

function formatPercent(value: number | null | undefined, digits: number = 0): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
  return `${(value * 100).toFixed(digits)}%`
}

function formatMaybe(value: number | null | undefined, digits: number = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
  return value.toFixed(digits)
}

function buildFallbackSummary(item: TrendFeedItem): TrendSummary {
  const displayName = item.displayName ?? item.playerId
  const trendLabel = TREND_LABELS[item.trendType]
  return {
    headline: `${displayName} is flagged as a ${trendLabel.toLowerCase()}.`,
    rationale: `Trend score ${item.trendScore.toFixed(1)} with usage ${formatSigned(item.signals?.usageChange ?? 0, 2)} and share ${formatPercent(item.signals?.minutesOrSnapShare ?? 0)}.`,
    recommendation: 'Open the AI overlay for a provider-backed explanation.',
  }
}

function InsightBlock({
  label,
  value,
}: {
  label: string
  value: string | null
}) {
  if (!value) return null
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-3 text-sm text-slate-700 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/60 dark:text-slate-200">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-1 leading-6">{value}</p>
    </div>
  )
}

function MetricTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative' | 'neutral'
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'negative'
        ? 'text-rose-700 dark:text-rose-300'
        : 'text-slate-700 dark:text-slate-200'
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-700/80 dark:bg-slate-900/50">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className={`mt-2 text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  )
}

function SnapshotRail({
  snapshot,
}: {
  snapshot: TrendSignalSnapshot
}) {
  const metrics = [
    {
      label: 'Fantasy avg',
      recent: formatMaybe(snapshot.recentFantasyPointsAvg, 1),
      prior: formatMaybe(snapshot.priorFantasyPointsAvg, 1),
    },
    {
      label: 'Usage',
      recent: formatMaybe(snapshot.recentUsageValue, 2),
      prior: formatMaybe(snapshot.priorUsageValue, 2),
    },
    {
      label: 'Efficiency',
      recent: formatMaybe(snapshot.recentEfficiency, 1),
      prior: formatMaybe(snapshot.priorEfficiency, 1),
    },
  ]

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="rounded-2xl border border-slate-200/80 bg-white/75 p-3 dark:border-slate-700/80 dark:bg-slate-900/60"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            {metric.label}
          </p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                Recent
              </p>
              <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {metric.recent}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                Prior
              </p>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {metric.prior}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function TrendCard({ item }: { item: TrendFeedItem }) {
  const [insight, setInsight] = useState<TrendAIInsight | null>(null)
  const [loadingInsight, setLoadingInsight] = useState(false)
  const signals = { ...DEFAULT_SIGNALS, ...(item.signals ?? {}) }
  const snapshot = { ...DEFAULT_SNAPSHOT, ...(item.snapshot ?? {}) }
  const summary = item.summary ?? buildFallbackSummary(item)
  const toneForDelta =
    (signals.performanceDelta ?? 0) > 0 ? 'positive' : (signals.performanceDelta ?? 0) < 0 ? 'negative' : 'neutral'
  const toneForUsage =
    signals.usageChange > 0 ? 'positive' : signals.usageChange < 0 ? 'negative' : 'neutral'
  const toneForEfficiency =
    (signals.efficiencyDelta ?? 0) > 0 ? 'positive' : (signals.efficiencyDelta ?? 0) < 0 ? 'negative' : 'neutral'

  const loadInsight = useCallback(() => {
    if (insight !== null) return
    setLoadingInsight(true)
    fetch(
      `/api/player-trend/insight?playerId=${encodeURIComponent(item.playerId)}&sport=${encodeURIComponent(item.sport)}`
    )
      .then((response) => response.json())
      .then((data) => {
        if (data?.insight) setInsight(data.insight)
      })
      .finally(() => setLoadingInsight(false))
  }, [insight, item.playerId, item.sport])

  return (
    <article
      className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.45)] backdrop-blur dark:border-slate-700/80 dark:bg-slate-950/75"
      data-testid="trend-feed-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${TREND_COLORS[item.trendType]}`}>
              {TREND_LABELS[item.trendType]}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              {item.sport}
            </span>
            {item.team && (
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {item.team}
              </span>
            )}
            {item.position && (
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {item.position}
              </span>
            )}
          </div>
          <div>
            <h3 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
              {item.displayName ?? item.playerId}
            </h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{summary.headline}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/90 px-4 py-3 text-right dark:border-slate-700/80 dark:bg-slate-900/70">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Signal strength
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-slate-100">
            {signals.signalStrength.toFixed(0)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {Math.round(signals.confidence * 100)}% confidence
          </p>
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-700 dark:text-slate-200">
        {summary.rationale}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Performance delta" value={formatSigned(signals.performanceDelta, 1)} tone={toneForDelta} />
        <MetricTile label="Usage change" value={formatSigned(signals.usageChange, 2)} tone={toneForUsage} />
        <MetricTile label="Role share" value={formatPercent(signals.minutesOrSnapShare)} />
        <MetricTile label="Efficiency" value={formatMaybe(signals.efficiencyScore, 1)} tone={toneForEfficiency} />
      </div>

      <div className="mt-4 rounded-[24px] border border-slate-200/80 bg-gradient-to-br from-slate-50 to-white p-4 dark:border-slate-700/80 dark:from-slate-900/60 dark:to-slate-950/80">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Deterministic snapshot
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Source {snapshot.dataSource.replace('_', ' ')} | recent sample {snapshot.recentGamesSample} | prior sample {snapshot.priorGamesSample}
            </p>
          </div>
          <div className="text-right text-sm text-slate-600 dark:text-slate-300">
            <p>Trend score {item.trendScore.toFixed(1)}</p>
            <p>Direction {item.direction}</p>
          </div>
        </div>
        <SnapshotRail snapshot={snapshot} />
      </div>

      <div className="mt-4 rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-700/80 dark:bg-slate-900/60">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Coach note
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
          {summary.recommendation}
        </p>
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={loadInsight}
          disabled={loadingInsight}
          className="rounded-full border border-slate-300/90 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
        >
          {loadingInsight ? 'Loading...' : 'Get AI insight'}
        </button>
        {insight && (
          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            <InsightBlock label="DeepSeek math validation" value={insight.mathValidation} />
            <InsightBlock label="Grok hype detection" value={insight.hypeDetection} />
            <InsightBlock label="OpenAI explanation" value={insight.actionableExplanation} />
          </div>
        )}
      </div>
    </article>
  )
}

export default function TrendFeedPage() {
  const searchParams = useSearchParams()
  const [sport, setSport] = useState<string>(DEFAULT_SPORT)
  const [timeframe, setTimeframe] = useState<TimeframeId>('7d')
  const [items, setItems] = useState<TrendFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const qpSport = searchParams?.get('sport')
    const qpTimeframe = searchParams?.get('timeframe')
    if (qpSport && isSupportedSport(qpSport)) {
      setSport(normalizeToSupportedSport(qpSport))
    }
    if (qpTimeframe === '24h' || qpTimeframe === '7d' || qpTimeframe === '30d') {
      setTimeframe(qpTimeframe)
    }
  }, [searchParams])

  const loadFeed = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(
      `/api/player-trend/feed?sport=${encodeURIComponent(sport)}&timeframe=${encodeURIComponent(timeframe)}&limit=60`
    )
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data?.data)) setItems(data.data)
        else setItems([])
      })
      .catch(() => setError('Failed to load trend feed'))
      .finally(() => setLoading(false))
  }, [sport, timeframe])

  useEffect(() => {
    loadFeed()
  }, [loadFeed])

  const groupedItems = useMemo(() => ({
    hot_streak: items.filter((item) => item.trendType === 'hot_streak'),
    breakout_candidate: items.filter((item) => item.trendType === 'breakout_candidate'),
    sell_high_candidate: items.filter((item) => item.trendType === 'sell_high_candidate'),
    cold_streak: items.filter((item) => item.trendType === 'cold_streak'),
  }), [items])

  const avgConfidence = useMemo(() => {
    if (items.length === 0) return 0
    return items.reduce((sum, item) => sum + (item.signals?.confidence ?? DEFAULT_SIGNALS.confidence), 0) / items.length
  }, [items])

  const topSignalItem = useMemo(() => {
    return [...items].sort(
      (a, b) => (b.signals?.signalStrength ?? 0) - (a.signals?.signalStrength ?? 0)
    )[0] ?? null
  }, [items])

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.18),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(34,197,94,0.12),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_45%,_#f8fafc_100%)] px-4 py-6 text-slate-950 dark:bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.08),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.08),_transparent_24%),linear-gradient(180deg,_#020617_0%,_#0f172a_45%,_#111827_100%)] dark:text-slate-50 sm:px-6">
      <div className="mx-auto w-full max-w-7xl">
        <nav className="mb-6 flex flex-wrap items-center gap-3 text-sm">
          <Link href="/core" className="text-slate-600 transition hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
            Back to app home
          </Link>
        </nav>

        <section className="overflow-hidden rounded-[32px] border border-slate-200/80 bg-white/80 p-6 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.45)] backdrop-blur dark:border-slate-700/80 dark:bg-slate-950/70">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">
                Player trend detection engine
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50 sm:text-4xl">
                Player trend feed
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                Deterministic trend signals blend recent production, opportunity changes, role share, and efficiency across every supported sport. Open any card for DeepSeek math checks, Grok hype framing, and OpenAI coach-style advice.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
              <MetricTile label="Detected players" value={String(items.length)} />
              <MetricTile label="Average confidence" value={formatPercent(avgConfidence)} />
              <MetricTile
                label="Top signal"
                value={topSignalItem ? `${topSignalItem.displayName ?? topSignalItem.playerId}` : 'N/A'}
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <select
              value={sport}
              onChange={(event) => setSport(event.target.value)}
              className="rounded-full border border-slate-300 bg-white/90 px-4 py-2 text-sm text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              aria-label="Sport"
            >
              {SUPPORTED_SPORTS.map((supportedSport) => (
                <option key={supportedSport} value={supportedSport}>
                  {supportedSport}
                </option>
              ))}
            </select>
            <select
              value={timeframe}
              onChange={(event) => setTimeframe(event.target.value as TimeframeId)}
              className="rounded-full border border-slate-300 bg-white/90 px-4 py-2 text-sm text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              aria-label="Timeframe"
            >
              {TIMEFRAME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadFeed}
              disabled={loading}
              className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </section>

        {error && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {loading && items.length === 0 ? (
          <p className="mt-8 text-sm text-slate-600 dark:text-slate-300">Loading trends...</p>
        ) : items.length === 0 ? (
          <p className="mt-8 text-sm text-slate-600 dark:text-slate-300">No trend data for this sport yet.</p>
        ) : (
          <div className="mt-8 space-y-8">
            {(['hot_streak', 'breakout_candidate', 'sell_high_candidate', 'cold_streak'] as const).map((type) => {
              const sectionItems = groupedItems[type]
              if (sectionItems.length === 0) return null
              return (
                <section key={type}>
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">
                        {TREND_LABELS[type]}
                      </p>
                      <h2 className="mt-1 text-2xl font-semibold text-slate-950 dark:text-slate-50">
                        {sectionItems.length} flagged players
                      </h2>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Top card {sectionItems[0]?.displayName ?? sectionItems[0]?.playerId ?? 'N/A'}
                    </p>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {sectionItems.map((item) => (
                      <TrendCard key={`${item.playerId}:${item.sport}:${item.trendType}`} item={item} />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
