'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import type { LeagueSport } from '@prisma/client'
import type { PlayerDynastyIntelligence } from '@/lib/dynasty-intelligence'
import type { DynastyAIInsight } from '@/lib/dynasty-intelligence/DynastyIntelligenceAI'

const POSITIONS_BY_SPORT: Record<string, readonly string[]> = {
  NFL: ['QB', 'RB', 'WR', 'TE'],
  NHL: ['C', 'LW', 'RW', 'D', 'G'],
  NBA: ['PG', 'SG', 'SF', 'PF', 'C'],
  MLB: ['SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'OF'],
  NCAAB: ['PG', 'SG', 'SF', 'PF', 'C'],
  NCAAF: ['QB', 'RB', 'WR', 'TE'],
  SOCCER: ['FWD', 'MID', 'DEF', 'GK'],
}

function getPositionsForSport(sport: string): readonly string[] {
  return POSITIONS_BY_SPORT[sport] ?? POSITIONS_BY_SPORT.NFL
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

function formatPercent(value: number | null | undefined, digits: number = 0): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${(value * 100).toFixed(digits)}%`
}

function formatDirection(value: string | null | undefined): string {
  if (!value) return 'Stable'
  if (value.toLowerCase() === 'up') return 'Rising'
  if (value.toLowerCase() === 'down') return 'Falling'
  return value
}

type ProviderCard = {
  provider: string
  label: string
  text: string
  fallback: boolean
}

function getOverviewCards(data: PlayerDynastyIntelligence) {
  if (Array.isArray(data.overviewCards) && data.overviewCards.length > 0) return data.overviewCards
  return [
    {
      id: 'lifecycle',
      label: 'Lifecycle',
      value: data.lifecycleStage ?? 'Prime',
      detail: `Peak ${data.ageCurve.peakAgeStart}-${data.ageCurve.peakAgeEnd}`,
      tone: 'neutral' as const,
    },
    {
      id: 'valuation',
      label: 'Value',
      value: `${data.currentValue}`,
      detail: data.valuationBand ?? 'Starter',
      tone: 'neutral' as const,
    },
    {
      id: 'market',
      label: 'Trend',
      value: formatDirection(data.marketValueTrend?.direction),
      detail: data.marketValueTrend ? `${formatNumber(data.marketValueTrend.trendScore)} trend score` : 'No market data',
      tone: 'neutral' as const,
    },
    {
      id: 'action',
      label: 'Action',
      value: data.marketRecommendation ?? 'Monitor',
      detail: data.careerTrajectory ? data.careerTrajectory.trajectoryLabel : 'No trajectory',
      tone: 'neutral' as const,
    },
  ]
}

function getProviderCards(insight: DynastyAIInsight | null): ProviderCard[] {
  if (!insight) return []
  if (Array.isArray(insight.providers) && insight.providers.length > 0) return insight.providers
  return [
    insight.mathValidation
      ? { provider: 'DeepSeek', label: 'Math validation', text: insight.mathValidation, fallback: false }
      : null,
    insight.narrative
      ? { provider: 'Grok', label: 'Narrative', text: insight.narrative, fallback: false }
      : null,
    insight.explanation
      ? { provider: 'OpenAI', label: 'Final explanation', text: insight.explanation, fallback: false }
      : null,
  ].filter((card): card is ProviderCard => card != null)
}

export default function DynastyInsightsPage() {
  const [sport, setSport] = useState(SUPPORTED_SPORTS[0])
  const [position, setPosition] = useState('WR')
  const [age, setAge] = useState<number | ''>(25)
  const [baseValue, setBaseValue] = useState<number | ''>(5000)
  const [playerId, setPlayerId] = useState('')
  const [isSuperFlex, setIsSuperFlex] = useState(false)
  const [isTightEndPremium, setIsTightEndPremium] = useState(false)
  const [data, setData] = useState<PlayerDynastyIntelligence | null>(null)
  const [insight, setInsight] = useState<DynastyAIInsight | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingAI, setLoadingAI] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)

  const positions = getPositionsForSport(sport)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError(null)
      setInsight(null)
      const params = new URLSearchParams()
      params.set('sport', sport)
      params.set('position', position)
      if (age !== '') params.set('age', String(age))
      if (baseValue !== '') params.set('baseValue', String(baseValue))
      if (playerId.trim()) params.set('playerId', playerId.trim())
      if (isSuperFlex) params.set('isSuperFlex', '1')
      if (isTightEndPremium) params.set('isTightEndPremium', '1')

      try {
        const response = await fetch(`/api/dynasty-intelligence?${params.toString()}`, {
          cache: 'no-store',
        })
        const payload = await response.json()
        if (!response.ok || payload?.error) {
          throw new Error(payload?.error ?? 'Failed to load dynasty intelligence')
        }
        if (active) setData(payload.data)
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load dynasty intelligence')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [sport, position, age, baseValue, playerId, isSuperFlex, isTightEndPremium, refreshNonce])

  async function loadAIInsight() {
    setLoadingAI(true)
    setError(null)
    const params = new URLSearchParams()
    params.set('sport', sport)
    params.set('position', position)
    if (age !== '') params.set('age', String(age))
    if (baseValue !== '') params.set('baseValue', String(baseValue))
    if (playerId.trim()) params.set('playerId', playerId.trim())
    if (isSuperFlex) params.set('isSuperFlex', '1')
    if (isTightEndPremium) params.set('isTightEndPremium', '1')
    params.set('ai', '1')

    try {
      const response = await fetch(`/api/dynasty-intelligence?${params.toString()}`, {
        cache: 'no-store',
      })
      const payload = await response.json()
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error ?? 'Failed to load dynasty intelligence')
      }
      setData(payload.data)
      setInsight(payload.insight ?? null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load dynasty intelligence')
    } finally {
      setLoadingAI(false)
    }
  }

  const overviewCards = data ? getOverviewCards(data) : []
  const providerCards = getProviderCards(insight)
  const currentAge = data?.age ?? null
  const ageCurvePoints =
    data?.ageCurve.points.filter(
      (point) =>
        point.label ||
        currentAge == null ||
        Math.abs(point.age - currentAge) <= 4 ||
        point.age % 2 === 1
    ) ?? []

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <nav className="mb-5 flex flex-wrap items-center gap-3 text-sm text-slate-500">
        <Link href="/core" className="hover:text-slate-900 dark:hover:text-white">
          <span aria-hidden="true">&larr;</span> App home
        </Link>
      </nav>

      <section className="rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_28%),linear-gradient(135deg,_#f8fafc_0%,_#fff7ed_46%,_#eff6ff_100%)] p-6 shadow-sm">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Dynasty Intelligence Engine
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            Dynasty valuation intelligence
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-600">
            Read the dynasty profile through three lenses: age curve, market value trend, and
            career trajectory. The engine stays deterministic, then layers DeepSeek, Grok, and
            OpenAI explanations on top when you want the coach-side read.
          </p>
        </div>

        <div className="mt-6 grid gap-3 rounded-3xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur lg:grid-cols-4">
          <label className="space-y-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            <span>Sport</span>
            <select
              value={sport}
              onChange={(event) => {
                setSport(event.target.value as LeagueSport)
                setPosition(getPositionsForSport(event.target.value as LeagueSport)[0] ?? 'WR')
              }}
              aria-label="Dynasty insights sport filter"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900"
            >
              {SUPPORTED_SPORTS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            <span>Position</span>
            <select
              value={position}
              onChange={(event) => setPosition(event.target.value)}
              aria-label="Dynasty insights position filter"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900"
            >
              {positions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            <span>Age</span>
            <input
              type="number"
              min={18}
              max={45}
              value={age}
              onChange={(event) => setAge(event.target.value === '' ? '' : parseInt(event.target.value, 10))}
              aria-label="Dynasty insights player age"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900"
            />
          </label>

          <label className="space-y-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            <span>Base value</span>
            <input
              type="number"
              min={0}
              value={baseValue}
              onChange={(event) => setBaseValue(event.target.value === '' ? '' : parseFloat(event.target.value))}
              aria-label="Dynasty insights base value"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900"
            />
          </label>

          <label className="space-y-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500 lg:col-span-2">
            <span>Player ID (optional)</span>
            <input
              type="text"
              value={playerId}
              onChange={(event) => setPlayerId(event.target.value)}
              placeholder="e.g. sleeper player id"
              aria-label="Dynasty insights player id"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
            <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isSuperFlex}
                onChange={(event) => setIsSuperFlex(event.target.checked)}
                aria-label="Dynasty superflex toggle"
              />
              SuperFlex
            </label>
            <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isTightEndPremium}
                onChange={(event) => setIsTightEndPremium(event.target.checked)}
                aria-label="Dynasty tight end premium toggle"
              />
              TE Premium
            </label>
          </div>

          <div className="flex flex-wrap gap-2 lg:col-span-4">
            <button
              type="button"
              onClick={() => setRefreshNonce((current) => current + 1)}
              disabled={loading}
              aria-label="Refresh dynasty insights"
              className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? 'Loading...' : 'Update'}
            </button>
            <button
              type="button"
              onClick={loadAIInsight}
              disabled={loading || loadingAI}
              aria-label="Get AI dynasty insights"
              className="rounded-2xl bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-60"
            >
              {loadingAI ? 'AI...' : 'Get AI dynasty insights'}
            </button>
          </div>
        </div>
      </section>

      {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}

      {data ? (
        <div className="mt-6 space-y-6">
          {data.displayName ? (
            <p className="text-sm font-medium text-slate-700">
              Player: {data.displayName}
              {data.team ? ` (${data.team})` : ''}
            </p>
          ) : null}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {overviewCards.map((card) => (
              <article
                key={card.id}
                className={`rounded-[24px] border p-4 shadow-sm ${
                  card.tone === 'positive'
                    ? 'border-emerald-200 bg-emerald-50'
                    : card.tone === 'negative'
                      ? 'border-rose-200 bg-rose-50'
                      : 'border-slate-200 bg-white'
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {card.label}
                </p>
                <p className="mt-3 text-2xl font-semibold text-slate-950">{card.value}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{card.detail}</p>
              </article>
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">
                Age curve ({data.ageCurve.sport} {data.ageCurve.position})
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Peak {data.ageCurve.peakAgeStart}-{data.ageCurve.peakAgeEnd} | cliff at {data.ageCurve.cliffAge} | risk {data.ageCurve.riskBand}
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {ageCurvePoints.map((point) => (
                  <article key={point.age} className="rounded-3xl border border-slate-200 bg-slate-50/80 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-slate-900">Age {point.age}</p>
                      {point.label ? (
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                          {point.label}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">
                      {formatNumber(point.multiplier, 2)}x
                    </p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-400 via-cyan-500 to-emerald-500"
                        style={{ width: `${Math.max(0, Math.min(100, point.multiplier * 100))}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{point.stage ?? 'Prime'}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">Market value trend</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Direction {formatDirection(data.marketValueTrend?.direction)} | demand {formatNumber(data.marketValueTrend?.demandScore, 0)} | liquidity {formatNumber(data.marketValueTrend?.liquidityScore, 0)}
              </p>

              {data.marketValueTrend ? (
                <div className="mt-5 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-3xl bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Trend score</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-950">
                        {formatNumber(data.marketValueTrend.trendScore, 1)}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        Delta {formatSignedNumber(data.marketValueTrend.scoreDelta, 1)}
                      </p>
                    </div>
                    <div className="rounded-3xl bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Confidence</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-950">
                        {formatPercent(data.marketValueTrend.confidence, 0)}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {data.marketValueTrend.signalLabel ?? 'Market conviction is holding steady.'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {(data.marketValueTrend.factors ?? []).map((factor) => (
                      <div key={factor.label} className="rounded-3xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-slate-900">{factor.label}</p>
                          <p className="text-sm text-slate-500">{factor.displayValue}</p>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-slate-900"
                            style={{ width: `${Math.max(0, Math.min(100, factor.value * 100))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Market signals
                    </p>
                    <ul className="mt-3 space-y-2 text-sm text-slate-600">
                      {(data.marketValueTrend.signals ?? []).map((signal) => (
                        <li key={signal} className="rounded-2xl bg-white px-3 py-2">
                          {signal}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">No market trend data is available.</p>
              )}
            </div>
          </section>

          {data.careerTrajectory ? (
            <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">
                Career trajectory (window: {data.careerTrajectory.expectedWindowYears} years)
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {data.careerTrajectory.trajectoryLabel ?? 'Stable'} path | peak at year +
                {data.careerTrajectory.peakYearOffset ?? 0} | retention score{' '}
                {data.careerTrajectory.retentionScore ?? '--'}
              </p>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="px-3 py-3">Year</th>
                      <th className="px-3 py-3">Age</th>
                      <th className="px-3 py-3">Projected value</th>
                      <th className="px-3 py-3">Age mult.</th>
                      <th className="px-3 py-3">Window</th>
                      <th className="px-3 py-3">Retention</th>
                      <th className="px-3 py-3">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.careerTrajectory.points.map((point) => (
                      <tr key={point.yearOffset} className="border-b border-slate-100">
                        <td className="px-3 py-4">+{point.yearOffset}</td>
                        <td className="px-3 py-4">{point.age}</td>
                        <td className="px-3 py-4 font-medium text-slate-900">{point.projectedValue}</td>
                        <td className="px-3 py-4">{formatNumber(point.ageMultiplier, 2)}</td>
                        <td className="px-3 py-4">{formatNumber(point.windowYears, 1)}</td>
                        <td className="px-3 py-4">{formatPercent(point.retentionRate, 0)}</td>
                        <td className="px-3 py-4 text-slate-500">{point.note ?? '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {insight ? (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-950">AI insight</h2>
              <div className="grid gap-4 lg:grid-cols-3">
                {providerCards.map((provider) => (
                  <article
                    key={`${provider.provider}-${provider.label}`}
                    className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-slate-900">{provider.provider}</p>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {provider.fallback ? 'Fallback' : provider.label}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{provider.text}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  )
}
