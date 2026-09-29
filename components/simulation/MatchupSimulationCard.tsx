'use client'

import Link from 'next/link'
import { useMemo, useState, useEffect, useCallback } from 'react'
import { DEFAULT_SPORT } from '@/lib/sport-scope'
import type {
  MatchupPredictionEngineOutput,
  MatchupPredictionScoringRulesInput,
} from '@/lib/matchup-prediction-engine'
import {
  getMatchupAIChatUrl,
  buildMatchupSummaryForAI,
  buildPositionComparisonRows,
  formatScoreRangeLabel,
  getViewState,
  MATCHUP_SIMULATOR_MESSAGES,
  resolveComparisonSummary,
  resultToDisplayProps,
} from '@/lib/matchup-simulator'

export type MatchupSimulationResult = {
  winProbabilityA: number
  winProbabilityB: number
  marginMean: number
  marginStdDev: number
  projectedScoreA: number
  projectedScoreB: number
  scoreRangeA: [number, number]
  scoreRangeB: [number, number]
  upsetChance: number
  volatilityTag: 'low' | 'medium' | 'high'
  iterations?: number
  prediction?: MatchupPredictionEngineOutput | null
}

export type MatchupSimulationCardProps = {
  teamAName: string
  teamBName: string
  /** Precomputed result; if not provided, will POST to /api/simulation/matchup when projections are set */
  result?: MatchupSimulationResult | null
  /** When result is not provided: team projections for client-side fetch */
  teamA?: { mean: number; stdDev?: number }
  teamB?: { mean: number; stdDev?: number }
  /** Optional current scores to show */
  scoreA?: number
  scoreB?: number
  /** Sport for API and AI context; defaults to NFL */
  sport?: string
  leagueId?: string
  weekOrPeriod?: number
  teamAId?: string
  teamBId?: string
  scoringRules?: MatchupPredictionScoringRulesInput
  persist?: boolean
  className?: string
}

function VolatilityTag({ tag }: { tag: 'low' | 'medium' | 'high' }) {
  const [label, color] =
    tag === 'high'
      ? ['High volatility', 'bg-amber-500/20 text-amber-400']
      : tag === 'medium'
        ? ['Medium volatility', 'bg-cyan-500/20 text-cyan-400']
        : ['Low volatility', 'bg-emerald-500/20 text-emerald-400']
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}
      title="Score variance from simulation"
    >
      {label}
    </span>
  )
}

export function MatchupSimulationCard({
  teamAName,
  teamBName,
  result: resultProp,
  teamA,
  teamB,
  scoreA,
  scoreB,
  sport = DEFAULT_SPORT,
  leagueId,
  weekOrPeriod,
  teamAId,
  teamBId,
  scoringRules,
  persist = false,
  className = '',
}: MatchupSimulationCardProps) {
  const [result, setResult] = useState<MatchupSimulationResult | null>(resultProp ?? null)
  const [loading, setLoading] = useState(!resultProp && !!teamA && !!teamB)
  const [error, setError] = useState<string | null>(null)
  const [positionTab, setPositionTab] = useState<'all' | 'edges'>('all')

  const runSimulation = useCallback(() => {
    const hasProjections =
      typeof teamA?.mean === 'number' && typeof teamB?.mean === 'number'
    if (!hasProjections) return
    setError(null)
    setLoading(true)
    fetch('/api/simulation/matchup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sport,
        leagueId,
        weekOrPeriod,
        persist,
        scoringRules,
        teamA: { mean: teamA?.mean ?? 0, stdDev: teamA?.stdDev, teamId: teamAId },
        teamB: { mean: teamB?.mean ?? 0, stdDev: teamB?.stdDev, teamId: teamBId },
      }),
    })
      .then((res) => {
        if (res.ok) return res.json()
        return res.json().then((d) => { throw new Error(d?.error || 'Simulation failed') })
      })
      .then((data) => { setResult(data); setError(null) })
      .catch((err) => { setError(err?.message ?? 'Simulation failed'); setResult(null) })
      .finally(() => setLoading(false))
  }, [
    leagueId,
    persist,
    sport,
    scoringRules,
    teamA?.mean,
    teamA?.stdDev,
    teamAId,
    teamB?.mean,
    teamB?.stdDev,
    teamBId,
    weekOrPeriod,
  ])

  useEffect(() => {
    if (resultProp != null) {
      setResult(resultProp)
      setLoading(false)
      setError(null)
      return
    }
    const hasProjections =
      typeof teamA?.mean === 'number' && typeof teamB?.mean === 'number'
    if (!hasProjections) {
      setLoading(false)
      return
    }
    let cancelled = false
    setError(null)
    fetch('/api/simulation/matchup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sport,
        leagueId,
        weekOrPeriod,
        persist,
        scoringRules,
        teamA: { mean: teamA?.mean ?? 0, stdDev: teamA?.stdDev, teamId: teamAId },
        teamB: { mean: teamB?.mean ?? 0, stdDev: teamB?.stdDev, teamId: teamBId },
      }),
    })
      .then((res) => {
        if (res.ok) return res.json()
        return res.json().then((d) => { throw new Error(d?.error || 'Simulation failed') })
      })
      .then((data) => { if (!cancelled) setResult(data); if (!cancelled) setError(null) })
      .catch((err) => { if (!cancelled) setError(err?.message ?? 'Simulation failed'); if (!cancelled) setResult(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [
    leagueId,
    persist,
    resultProp,
    sport,
    scoringRules,
    teamA?.mean,
    teamA?.stdDev,
    teamAId,
    teamB?.mean,
    teamB?.stdDev,
    teamBId,
    weekOrPeriod,
  ])

  const hasProjections =
    typeof teamA?.mean === 'number' && typeof teamB?.mean === 'number'
  const viewState = getViewState(hasProjections, loading, error, result)
  const display = useMemo(() => (result ? resultToDisplayProps(result) : null), [result])
  const comparisonSummary = useMemo(
    () => (result ? resolveComparisonSummary(teamAName, teamBName, result) : null),
    [result, teamAName, teamBName]
  )
  const positionRows = useMemo(() => {
    if (!display) return []
    return buildPositionComparisonRows({
      sport,
      teamAMean: display.projectedScoreA,
      teamBMean: display.projectedScoreB,
      teamAStdDev: teamA?.stdDev,
      teamBStdDev: teamB?.stdDev,
      maxRows: 6,
    })
  }, [display, sport, teamA?.stdDev, teamB?.stdDev])

  if (viewState === 'loading') {
    return (
      <div
        className={`rounded-xl border border-white/10 bg-white/[0.02] p-4 ${className}`}
      >
        <div className="animate-pulse text-sm text-white/40">{MATCHUP_SIMULATOR_MESSAGES.loading}</div>
      </div>
    )
  }

  if (viewState === 'error') {
    return (
      <div
        className={`rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3 ${className}`}
      >
        <p className="text-sm text-rose-400">{error ?? MATCHUP_SIMULATOR_MESSAGES.genericError}</p>
        <button
          type="button"
          onClick={runSimulation}
          disabled={loading}
          data-testid="matchup-card-retry"
          className="rounded border border-white/20 px-2 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-50"
        >
          Sim My Matchup
        </button>
      </div>
    )
  }

  if (viewState === 'empty' || !display) {
    return (
      <div
        className={`rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/50 ${className}`}
      >
        {MATCHUP_SIMULATOR_MESSAGES.empty}
      </div>
    )
  }

  const explainUrl = getMatchupAIChatUrl(
    buildMatchupSummaryForAI({
      teamAName,
      teamBName,
      projectedScoreA: display.projectedScoreA,
      projectedScoreB: display.projectedScoreB,
      winProbA: display.winProbA,
      winProbB: display.winProbB,
      upsetChance: display.upsetChance,
      scoreRangeA: display.scoreRangeA,
      scoreRangeB: display.scoreRangeB,
      volatilityTag: display.volatilityTag,
      sport,
      strengths: comparisonSummary?.strengthBullets,
      weaknesses: comparisonSummary?.weaknessBullets,
      positionEdgeSummary: positionRows
        .filter((row) => row.advantage !== 'even')
        .slice(0, 2)
        .map((row) => `${row.slotLabel}: ${row.edgeLabel}`)
        .join(', '),
    }),
    {
      leagueId,
      insightType: 'matchup',
      sport,
      week: weekOrPeriod,
    }
  )
  const visibleRows =
    positionTab === 'edges' ? positionRows.filter((row) => row.advantage !== 'even') : positionRows

  return (
    <div
      className={`rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-white/70 uppercase tracking-wider">
          Matchup simulation
        </h3>
        <div className="flex items-center gap-2">
          <Link
            href={explainUrl}
            data-testid="matchup-card-ai-explain"
            className="rounded border border-cyan-500/40 px-2 py-0.5 text-[11px] text-cyan-300 hover:bg-cyan-500/10"
            title="Ask Chimmy to explain this matchup"
          >
            Explain matchup
          </Link>
          <button
            type="button"
            onClick={runSimulation}
            disabled={loading}
            data-testid="matchup-card-rerun"
            className="rounded border border-white/20 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10 disabled:opacity-50"
            title="Rerun simulation"
          >
            {loading ? 'Running…' : result ? 'Rerun Simulation' : 'Sim My Matchup'}
          </button>
          <VolatilityTag tag={display.volatilityTag} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] font-medium text-white/80 truncate" title={teamAName}>
            {teamAName}
          </p>
          <p className="text-[11px] text-white/50 mt-0.5">
            Proj: {display.projectedScoreA.toFixed(1)} (range {formatScoreRangeLabel(display.scoreRangeA)})
          </p>
          {scoreA != null && (
            <p className="text-[11px] text-emerald-400/90 mt-0.5">Current: {scoreA.toFixed(1)}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium text-white/80 truncate" title={teamBName}>
            {teamBName}
          </p>
          <p className="text-[11px] text-white/50 mt-0.5">
            Proj: {display.projectedScoreB.toFixed(1)} (range {formatScoreRangeLabel(display.scoreRangeB)})
          </p>
          {scoreB != null && (
            <p className="text-[11px] text-emerald-400/90 mt-0.5">Current: {scoreB.toFixed(1)}</p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] text-white/50">
          <span>Win probability</span>
          <span>
            {display.winProbA >= 99 ? '99+' : display.winProbA.toFixed(1)}% – {display.winProbB >= 99 ? '99+' : display.winProbB.toFixed(1)}%
          </span>
        </div>
        <div className="h-3 rounded-full bg-white/10 overflow-hidden flex">
          <div
            className="bg-cyan-500/80 transition-all duration-500"
            style={{ width: `${display.winProbA}%` }}
          />
          <div
            className="bg-amber-500/80 transition-all duration-500"
            style={{ width: `${display.winProbB}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-cyan-400/90">{display.winProbA.toFixed(0)}%</span>
          <span className="text-amber-400/90">{display.winProbB.toFixed(0)}%</span>
        </div>
      </div>

      {display.upsetChance > 5 && (
        <div className="flex items-center justify-between rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5">
          <span className="text-[11px] text-amber-300/90">Upset chance (underdog)</span>
          <span className="text-[11px] font-semibold text-amber-400">{display.upsetChance}%</span>
        </div>
      )}

      {result?.prediction && (
        <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-2">
          <p className="text-[11px] uppercase tracking-wider text-cyan-200/90">
            Deterministic prediction engine
          </p>
          <p className="mt-1 text-[11px] text-cyan-50/90">
            {result.prediction.projectedScoreA.toFixed(1)} -{' '}
            {result.prediction.projectedScoreB.toFixed(1)} projected •{' '}
            {(result.prediction.winProbabilityA * 100).toFixed(1)}% /{' '}
            {(result.prediction.winProbabilityB * 100).toFixed(1)}% win
          </p>
        </div>
      )}

      {comparisonSummary && (
        <div className="rounded-lg border border-white/10 bg-black/30 p-2.5 space-y-2">
          <p className="text-[11px] text-emerald-300">{comparisonSummary.strengthSummary}</p>
          <p className="text-[11px] text-amber-300">{comparisonSummary.weaknessSummary}</p>
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-black/30 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wider text-white/60">Position comparison</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="matchup-card-position-tab-all"
              onClick={() => setPositionTab('all')}
              className={`rounded px-2 py-0.5 text-[11px] ${
                positionTab === 'all'
                  ? 'bg-cyan-500/20 text-cyan-200'
                  : 'border border-white/20 text-white/65 hover:bg-white/10'
              }`}
            >
              All
            </button>
            <button
              type="button"
              data-testid="matchup-card-position-tab-edges"
              onClick={() => setPositionTab('edges')}
              className={`rounded px-2 py-0.5 text-[11px] ${
                positionTab === 'edges'
                  ? 'bg-cyan-500/20 text-cyan-200'
                  : 'border border-white/20 text-white/65 hover:bg-white/10'
              }`}
            >
              Edges
            </button>
          </div>
        </div>
        {visibleRows.length > 0 ? (
          <div className="space-y-1.5">
            {visibleRows.map((row) => (
              <div key={row.slotId} className="flex items-center justify-between text-[11px]">
                <span className="text-white/60">{row.slotLabel}</span>
                <span className="text-white/80">
                  {row.teamAScore.toFixed(1)} - {row.teamBScore.toFixed(1)}
                </span>
                <span
                  className={
                    row.advantage === 'even'
                      ? 'text-white/50'
                      : row.advantage === 'A'
                        ? 'text-cyan-300'
                        : 'text-amber-300'
                  }
                >
                  {row.edgeLabel}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-white/50">No clear edge in current position profile.</p>
        )}
      </div>

      {display.iterations != null && (
        <p className="text-[11px] text-white/30">{display.iterations.toLocaleString()} sims</p>
      )}
    </div>
  )
}
