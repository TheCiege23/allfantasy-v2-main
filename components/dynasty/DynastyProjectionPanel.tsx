'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { isWeatherSensitiveSport } from '@/lib/weather/outdoorSportMetadata'
import { useUserTimezone } from '@/hooks/useUserTimezone'

type DynastyProjection = {
  projectionId: string
  teamId: string
  leagueId: string
  sport: string
  championshipWindowScore: number
  rebuildProbability: number
  rosterStrength3Year: number
  rosterStrength5Year: number
  agingRiskScore: number
  futureAssetScore: number
  createdAt: string
}

type DynastyAdvice = {
  overallOutlook?: string
  keyRecommendation?: string
  contenderOrRebuilder?: string
  confidence?: number
}

type DynastyProjectionPanelProps = {
  leagueId: string
  initialSport?: string
  teamNames?: Record<string, string>
  onBackToOverview?: () => void
  className?: string
}

function asPercent(n: number): string {
  return `${Math.max(0, Math.min(100, n)).toFixed(1)}%`
}

function formatSigned(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}`
}

function directionLabel(row: DynastyProjection): 'Contending' | 'Rebuilding' | 'Transitioning' {
  if (row.championshipWindowScore >= 65 && row.rebuildProbability <= 40) return 'Contending'
  if (row.rebuildProbability >= 60) return 'Rebuilding'
  return 'Transitioning'
}

function metricForHorizon(row: DynastyProjection, horizon: '3y' | '5y'): number {
  return horizon === '3y' ? row.rosterStrength3Year : row.rosterStrength5Year
}

export function DynastyProjectionPanel({
  leagueId,
  initialSport = 'NFL',
  teamNames = {},
  onBackToOverview,
  className = '',
}: DynastyProjectionPanelProps) {
  const { formatInTimezone } = useUserTimezone()
  const [sport, setSport] = useState<string>(String(initialSport || 'NFL').toUpperCase())
  const [horizon, setHorizon] = useState<'3y' | '5y'>('3y')
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [compareA, setCompareA] = useState<string>('')
  const [compareB, setCompareB] = useState<string>('')
  const [projections, setProjections] = useState<DynastyProjection[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [refreshing, setRefreshing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const [aiAdvice, setAiAdvice] = useState<DynastyAdvice | null>(null)
  const [aiLoading, setAiLoading] = useState<boolean>(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [weatherLegendOpen, setWeatherLegendOpen] = useState(true)

  const load = useCallback(
    async (opts?: { refresh?: boolean }) => {
      setError(null)
      setAiError(null)
      setAiAdvice(null)
      if (opts?.refresh) setRefreshing(true)
      else setLoading(true)
      try {
        const q = new URLSearchParams()
        q.set('sport', sport)
        if (opts?.refresh) q.set('refresh', '1')
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/dynasty-projections?${q.toString()}`,
          { cache: 'no-store' }
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data?.error || 'Failed to load dynasty projections')
          setProjections([])
          return
        }
        const rows = Array.isArray(data?.projections)
          ? (data.projections as DynastyProjection[])
          : []
        setProjections(rows)
        setGeneratedAt(typeof data?.generatedAt === 'string' ? data.generatedAt : null)
      } catch {
        setError('Failed to load dynasty projections')
        setProjections([])
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [leagueId, sport]
  )

  const sorted = useMemo(() => {
    return [...projections].sort((a, b) => {
      const metricDelta = metricForHorizon(b, horizon) - metricForHorizon(a, horizon)
      if (metricDelta !== 0) return metricDelta
      return b.championshipWindowScore - a.championshipWindowScore
    })
  }, [horizon, projections])

  const selected = useMemo(() => {
    if (!selectedTeamId) return sorted[0] ?? null
    return sorted.find((p) => p.teamId === selectedTeamId) ?? sorted[0] ?? null
  }, [selectedTeamId, sorted])

  const comparison = useMemo(() => {
    if (!compareA || !compareB || compareA === compareB) return null
    const a = projections.find((p) => p.teamId === compareA)
    const b = projections.find((p) => p.teamId === compareB)
    if (!a || !b) return null
    return {
      a,
      b,
      delta3: a.rosterStrength3Year - b.rosterStrength3Year,
      delta5: a.rosterStrength5Year - b.rosterStrength5Year,
      deltaWindow: a.championshipWindowScore - b.championshipWindowScore,
      deltaRebuild: a.rebuildProbability - b.rebuildProbability,
      deltaPicks: a.futureAssetScore - b.futureAssetScore,
      deltaAging: a.agingRiskScore - b.agingRiskScore,
    }
  }, [compareA, compareB, projections])

  const runAiAdvice = useCallback(async () => {
    if (!selected) return
    setAiLoading(true)
    setAiError(null)
    try {
      const res = await fetch('/api/dynasty-outlook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          teamId: selected.teamId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAiError(data?.error || 'Failed to generate AI dynasty advice')
        return
      }
      setAiAdvice((data?.analysis ?? null) as DynastyAdvice | null)
    } catch {
      setAiError('Failed to generate AI dynasty advice')
    } finally {
      setAiLoading(false)
    }
  }, [leagueId, selected])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!sorted.length) {
      setSelectedTeamId('')
      setCompareA('')
      setCompareB('')
      return
    }
    const first = sorted[0]?.teamId ?? ''
    const second = sorted[1]?.teamId ?? first
    setSelectedTeamId((prev) => prev || first)
    setCompareA((prev) => prev || first)
    setCompareB((prev) => prev || second)
  }, [sorted])

  return (
    <section className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-white/90">Dynasty projections</h3>
          <p className="text-[11px] text-white/55">
            Long-term outlook with 3-year/5-year roster strength, rebuild probability, and future asset impact.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] text-white/60">
            Sport
            <select
              aria-label="Dynasty sport filter"
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              className="ml-1 rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white"
            >
              {SUPPORTED_SPORTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-white/60">
            Team
            <select
              aria-label="Dynasty team selector"
              value={selected?.teamId ?? ''}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="ml-1 rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white"
            >
              {sorted.map((row) => (
                <option key={`team-${row.teamId}`} value={row.teamId}>
                  {teamNames[row.teamId] ?? row.teamId}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label="Show 3-year dynasty outlook"
            onClick={() => setHorizon('3y')}
            className={`rounded px-2.5 py-1.5 text-xs ${horizon === '3y' ? 'bg-white text-black' : 'border border-white/20 bg-white/5 text-white/80 hover:bg-white/10'}`}
          >
            3-year
          </button>
          <button
            type="button"
            aria-label="Show 5-year dynasty outlook"
            onClick={() => setHorizon('5y')}
            className={`rounded px-2.5 py-1.5 text-xs ${horizon === '5y' ? 'bg-white text-black' : 'border border-white/20 bg-white/5 text-white/80 hover:bg-white/10'}`}
          >
            5-year
          </button>
          <button
            type="button"
            aria-label="Refresh dynasty projections"
            onClick={() => void load({ refresh: true })}
            disabled={refreshing}
            className="rounded border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh projections'}
          </button>
          <button
            type="button"
            aria-label="Get AI dynasty advice"
            onClick={() => void runAiAdvice()}
            disabled={!selected || aiLoading}
            className="rounded border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {aiLoading ? 'Analyzing…' : 'AI dynasty advice'}
          </button>
          <Link
            href={`/trade-finder?leagueId=${encodeURIComponent(leagueId)}&context=dynasty&dynastyTeamId=${encodeURIComponent(selected?.teamId ?? '')}`}
            aria-label="Open trade analyzer with dynasty context"
            className="rounded border border-violet-400/30 bg-violet-500/10 px-2.5 py-1.5 text-xs text-violet-200 hover:bg-violet-500/20"
          >
            Trade analyzer context
          </Link>
          {onBackToOverview ? (
            <button
              type="button"
              aria-label="Back to league overview"
              onClick={onBackToOverview}
              className="rounded border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10"
            >
              Back
            </button>
          ) : null}
        </div>
      </div>

      {generatedAt ? (
        <p className="mb-3 text-[11px] text-white/45">
          Updated {formatInTimezone(generatedAt)}
        </p>
      ) : null}

      {isWeatherSensitiveSport(sport) ? (
        <div className="mb-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5">
          <button
            type="button"
            onClick={() => setWeatherLegendOpen((o) => !o)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-semibold text-cyan-200/90"
          >
            <span>🌤 AF crest = weather-adjusted weekly projection (roster / players tabs)</span>
            <span className="text-white/45">{weatherLegendOpen ? '−' : '+'}</span>
          </button>
          {weatherLegendOpen ? (
            <p className="border-t border-white/[0.06] px-3 pb-2 pt-1 text-[11px] text-white/50">
              Dynasty scores here are long-term strength — for game-week weather adjustments, use the AF crest next to
              projected points on Team and Players tabs.
            </p>
          ) : null}
        </div>
      ) : null}

      {loading ? <p className="text-sm text-white/60">Loading dynasty projections...</p> : null}
      {error ? <p className="text-sm text-rose-400">{error}</p> : null}

      {!loading && !error && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3" data-audit="dynasty-ranking-cards">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/60">
              Dynasty ranking cards ({horizon === '3y' ? '3-year' : '5-year'})
            </h4>
            <div className="space-y-2">
              {sorted.map((row, i) => (
                <button
                  key={row.projectionId || `${row.teamId}-${i}`}
                  type="button"
                  onClick={() => setSelectedTeamId(row.teamId)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                    selected?.teamId === row.teamId
                      ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100'
                      : 'border-white/10 bg-white/[0.02] text-white/80 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>#{i + 1} {teamNames[row.teamId] ?? row.teamId}</span>
                    <span className="text-xs">
                      {metricForHorizon(row, horizon).toFixed(1)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-white/60">
                    <span>Rebuild {asPercent(row.rebuildProbability)}</span>
                    <span>Window {row.championshipWindowScore.toFixed(1)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3 lg:col-span-2">
            {selected ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-white">
                    Future outlook: {teamNames[selected.teamId] ?? selected.teamId}
                  </h4>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      directionLabel(selected) === 'Contending'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : directionLabel(selected) === 'Rebuilding'
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {directionLabel(selected)}
                  </span>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                    <p className="text-[11px] text-white/55">Roster strength (3-year)</p>
                    <p className="text-lg font-semibold text-white">{selected.rosterStrength3Year.toFixed(1)}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                    <p className="text-[11px] text-white/55">Roster strength (5-year)</p>
                    <p className="text-lg font-semibold text-white">{selected.rosterStrength5Year.toFixed(1)}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                    <p className="text-[11px] text-white/55">Rebuild probability</p>
                    <p className="text-lg font-semibold text-white">{asPercent(selected.rebuildProbability)}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                    <p className="text-[11px] text-white/55">Championship window</p>
                    <p className="text-lg font-semibold text-white">{selected.championshipWindowScore.toFixed(1)}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                    <p className="text-[11px] text-white/55">Aging risk</p>
                    <p className="text-lg font-semibold text-white">{selected.agingRiskScore.toFixed(1)}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                    <p className="text-[11px] text-white/55">Future asset score</p>
                    <p className="text-lg font-semibold text-white">{selected.futureAssetScore.toFixed(1)}</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/60">Championship window chart</p>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-emerald-400"
                        style={{ width: `${Math.max(0, Math.min(100, selected.championshipWindowScore))}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-white/50">Window score {selected.championshipWindowScore.toFixed(1)} / 100</p>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/60">Pick value drill-down</p>
                    <div className="space-y-1 text-xs text-white/70">
                      <p>Near-term capital: {(selected.futureAssetScore * 0.6).toFixed(1)}</p>
                      <p>Long-term capital: {(selected.futureAssetScore * 0.4).toFixed(1)}</p>
                      <p className="text-white/50">Derived from future pick ownership and projected slot value.</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/60">Roster strength trend graph</p>
                  <svg viewBox="0 0 240 60" className="h-14 w-full">
                    <polyline
                      fill="none"
                      stroke="rgb(34 211 238)"
                      strokeWidth="2"
                      points={`20,${55 - Math.min(50, selected.rosterStrength3Year * 0.5)} 220,${55 - Math.min(50, selected.rosterStrength5Year * 0.5)}`}
                    />
                    <circle cx="20" cy={55 - Math.min(50, selected.rosterStrength3Year * 0.5)} r="3" fill="rgb(34 211 238)" />
                    <circle cx="220" cy={55 - Math.min(50, selected.rosterStrength5Year * 0.5)} r="3" fill="rgb(34 211 238)" />
                    <text x="8" y="58" fill="rgb(148 163 184)" fontSize="10">3Y</text>
                    <text x="206" y="58" fill="rgb(148 163 184)" fontSize="10">5Y</text>
                  </svg>
                </div>
              </div>
            ) : (
              <p className="text-sm text-white/60">No dynasty projection rows available for this league and sport yet.</p>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3 lg:col-span-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/60">Long-term team comparison</h4>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <select
                aria-label="Dynasty comparison selector A"
                value={compareA}
                onChange={(e) => setCompareA(e.target.value)}
                className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white"
              >
                {sorted.map((row) => (
                  <option key={`cmp-a-${row.teamId}`} value={row.teamId}>
                    {teamNames[row.teamId] ?? row.teamId}
                  </option>
                ))}
              </select>
              <span className="text-xs text-white/45">vs</span>
              <select
                aria-label="Dynasty comparison selector B"
                value={compareB}
                onChange={(e) => setCompareB(e.target.value)}
                className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white"
              >
                {sorted.map((row) => (
                  <option key={`cmp-b-${row.teamId}`} value={row.teamId}>
                    {teamNames[row.teamId] ?? row.teamId}
                  </option>
                ))}
              </select>
            </div>
            {comparison ? (
              <div className="grid gap-2 text-xs text-white/75 sm:grid-cols-3">
                <p>3-year delta: {formatSigned(comparison.delta3)}</p>
                <p>5-year delta: {formatSigned(comparison.delta5)}</p>
                <p>Window delta: {formatSigned(comparison.deltaWindow)}</p>
                <p>Rebuild delta: {formatSigned(comparison.deltaRebuild)}%</p>
                <p>Pick asset delta: {formatSigned(comparison.deltaPicks)}</p>
                <p>Aging risk delta: {formatSigned(comparison.deltaAging)}</p>
              </div>
            ) : (
              <p className="text-xs text-white/50">Select two different teams to compare long-term outlook.</p>
            )}
          </div>
        </div>
      )}

      {aiError ? <p className="mt-3 text-xs text-rose-400">{aiError}</p> : null}
      {aiAdvice ? (
        <div className="mt-3 rounded-lg border border-cyan-400/20 bg-cyan-500/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">AI dynasty advice</p>
          {aiAdvice.overallOutlook ? <p className="mt-1 text-sm text-white/90">{aiAdvice.overallOutlook}</p> : null}
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-white/70">
            {aiAdvice.contenderOrRebuilder ? <span>Status: {aiAdvice.contenderOrRebuilder}</span> : null}
            {aiAdvice.confidence != null ? <span>Confidence: {aiAdvice.confidence}%</span> : null}
          </div>
          {aiAdvice.keyRecommendation ? (
            <p className="mt-2 text-sm text-white/85">
              <strong className="text-white/95">Recommendation:</strong> {aiAdvice.keyRecommendation}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

