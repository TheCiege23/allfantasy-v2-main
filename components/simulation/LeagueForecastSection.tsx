'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { LeagueForecastDashboard } from './LeagueForecastDashboard'
import type { TeamSeasonForecastDisplay } from './TeamForecastCard'

const currentYear = new Date().getFullYear()
const defaultWeek = 1

type LeagueForecastSectionProps = {
  leagueId: string
  season?: number
  week?: number
  /** Map teamId (roster id) -> display name */
  teamNames?: Record<string, string>
  /** Map teamId -> current rank (1-based) from standings */
  teamRanks?: Record<string, number>
  playoffSpots?: number
  className?: string
}

export function LeagueForecastSection({
  leagueId,
  season = currentYear,
  week = defaultWeek,
  teamNames = {},
  teamRanks = {},
  playoffSpots = 6,
  className = '',
}: LeagueForecastSectionProps) {
  const [selectedSeason, setSelectedSeason] = useState<number>(season)
  const [selectedWeek, setSelectedWeek] = useState<number>(week)
  const [activeSeason, setActiveSeason] = useState<number>(season)
  const [activeWeek, setActiveWeek] = useState<number>(week)
  const [selectedSimulations, setSelectedSimulations] = useState<number>(2000)
  const [selectedPlayoffSpots, setSelectedPlayoffSpots] = useState<number>(playoffSpots)

  const [forecasts, setForecasts] = useState<TeamSeasonForecastDisplay[] | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [compareA, setCompareA] = useState<string>('')
  const [compareB, setCompareB] = useState<string>('')

  const load = useCallback(async () => {
    if (!leagueId) return
    setError(null)
    setAiError(null)
    setAiSummary(null)
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/season-forecast?season=${activeSeason}&week=${activeWeek}`,
        { cache: 'no-store' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setForecasts(null)
        setGeneratedAt(null)
        if (res.status === 404) setError(null)
        else setError(data?.error || 'Failed to load forecast')
        return
      }
      if (data.generated && Array.isArray(data.teamForecasts)) {
        setForecasts(data.teamForecasts)
        setGeneratedAt(data.generatedAt ?? new Date().toISOString())
      } else {
        setForecasts(null)
        setGeneratedAt(null)
      }
    } catch {
      setError('Failed to load forecast')
      setForecasts(null)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeSeason, activeWeek, leagueId])

  const generate = useCallback(async () => {
    if (!leagueId) return
    setRefreshing(true)
    setError(null)
    setAiError(null)
    setAiSummary(null)
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/season-forecast`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            season: activeSeason,
            week: activeWeek,
            simulations: selectedSimulations,
            playoffSpots: selectedPlayoffSpots,
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Failed to generate forecast')
        return
      }
      if (Array.isArray(data.teamForecasts)) {
        setForecasts(data.teamForecasts)
        setGeneratedAt(data.generatedAt ?? new Date().toISOString())
      }
      await load()
    } catch {
      setError('Failed to generate forecast')
    } finally {
      setRefreshing(false)
    }
  }, [activeSeason, activeWeek, leagueId, load, selectedPlayoffSpots, selectedSimulations])

  const generateAiSummary = useCallback(async () => {
    if (!forecasts?.length) return
    setAiLoading(true)
    setAiError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/forecast-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season: activeSeason,
          week: activeWeek,
          teamForecasts: forecasts,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAiError(data?.error || "Chimmy couldn't generate an explanation")
        return
      }
      setAiSummary(typeof data?.summary === 'string' ? data.summary : null)
    } catch {
      setAiError("Chimmy couldn't generate an explanation")
    } finally {
      setAiLoading(false)
    }
  }, [activeSeason, activeWeek, forecasts, leagueId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEffect(() => {
    if (!forecasts?.length || aiSummary != null || aiLoading) return
    void generateAiSummary()
  }, [aiLoading, aiSummary, forecasts, generateAiSummary])

  useEffect(() => {
    if (!forecasts?.length) {
      setCompareA('')
      setCompareB('')
      return
    }
    const first = forecasts[0]?.teamId ?? ''
    const second = forecasts[1]?.teamId ?? first
    setCompareA((prev) => prev || first)
    setCompareB((prev) => prev || second)
  }, [forecasts])

  const comparison = useMemo(() => {
    if (!forecasts?.length || !compareA || !compareB || compareA === compareB) return null
    const a = forecasts.find((row) => row.teamId === compareA)
    const b = forecasts.find((row) => row.teamId === compareB)
    if (!a || !b) return null
    return {
      a,
      b,
      playoffDelta: a.playoffProbability - b.playoffProbability,
      championshipDelta: a.championshipProbability - b.championshipProbability,
      expectedWinsDelta: a.expectedWins - b.expectedWins,
      expectedSeedDelta: b.expectedFinalSeed - a.expectedFinalSeed,
    }
  }, [compareA, compareB, forecasts])

  if (loading && !forecasts) {
    return (
      <div className={`rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/50 ${className}`}>
        Loading season forecast…
      </div>
    )
  }

  if (error && !forecasts) {
    return (
      <div className={`space-y-3 ${className}`}>
        <p className="text-sm text-amber-400/90">{error}</p>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={refreshing}
          className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {refreshing ? 'Generating…' : 'Generate forecast'}
        </button>
      </div>
    )
  }

  if (!forecasts?.length) {
    return (
      <div className={`space-y-3 ${className}`}>
        <p className="text-sm text-white/60">
          No forecast for this league yet. Generate one from current standings and rankings.
        </p>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={refreshing}
          className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {refreshing ? 'Generating…' : 'Generate forecast'}
        </button>
      </div>
    )
  }

  const avgConfidence =
    forecasts.reduce((s, t) => s + t.confidenceScore, 0) / forecasts.length

  return (
    <div className={className}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-white/90">Season & playoff forecast</h2>
          <p className="text-[11px] text-white/55">Weekly season simulation with playoff/championship probabilities.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] text-white/60">
            Season
            <input
              type="number"
              value={selectedSeason}
              aria-label="Season simulation selector"
              onChange={(e) => setSelectedSeason(Math.max(2000, Number(e.target.value) || season))}
              className="ml-1 w-20 rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white"
            />
          </label>
          <label className="text-[11px] text-white/60">
            Week
            <input
              type="number"
              value={selectedWeek}
              aria-label="Week simulation selector"
              onChange={(e) => setSelectedWeek(Math.max(1, Number(e.target.value) || 1))}
              className="ml-1 w-16 rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white"
            />
          </label>
          <label className="text-[11px] text-white/60">
            Sims
            <select
              value={selectedSimulations}
              aria-label="Simulation count selector"
              onChange={(e) => setSelectedSimulations(Math.max(100, Number(e.target.value) || 2000))}
              className="ml-1 rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white"
            >
              {[500, 1000, 1500, 2000, 3000, 5000].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-white/60">
            Playoff spots
            <input
              type="number"
              min={1}
              value={selectedPlayoffSpots}
              aria-label="Playoff spots selector"
              onChange={(e) => setSelectedPlayoffSpots(Math.max(1, Number(e.target.value) || playoffSpots))}
              className="ml-1 w-16 rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setActiveSeason(selectedSeason)
              setActiveWeek(selectedWeek)
              setLoading(true)
              setAiSummary(null)
            }}
            className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={refreshing}
            aria-label="Rerun season simulation"
            className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            {refreshing ? 'Running…' : 'Rerun simulation'}
          </button>
          <button
            type="button"
            onClick={() => void generateAiSummary()}
            disabled={aiLoading || !forecasts?.length}
            aria-label="Explain season simulation with Chimmy"
            className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {aiLoading ? 'Explaining…' : "Chimmy's explanation"}
          </button>
        </div>
      </div>
      {aiError && <p className="mb-3 text-xs text-rose-400">{aiError}</p>}

      <div className="mb-4 rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">Team comparison</span>
          <select
            value={compareA}
            aria-label="Team comparison selector A"
            onChange={(e) => setCompareA(e.target.value)}
            className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white"
          >
            {(forecasts ?? []).map((f) => (
              <option key={`compare-a-${f.teamId}`} value={f.teamId}>
                {teamNames[f.teamId] ?? f.teamName ?? f.teamId}
              </option>
            ))}
          </select>
          <span className="text-xs text-white/45">vs</span>
          <select
            value={compareB}
            aria-label="Team comparison selector B"
            onChange={(e) => setCompareB(e.target.value)}
            className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white"
          >
            {(forecasts ?? []).map((f) => (
              <option key={`compare-b-${f.teamId}`} value={f.teamId}>
                {teamNames[f.teamId] ?? f.teamName ?? f.teamId}
              </option>
            ))}
          </select>
        </div>
        {comparison && (
          <div className="mt-2 grid gap-2 text-xs text-white/75 sm:grid-cols-2">
            <p>Playoff delta: {comparison.playoffDelta >= 0 ? '+' : ''}{comparison.playoffDelta.toFixed(1)}%</p>
            <p>Championship delta: {comparison.championshipDelta >= 0 ? '+' : ''}{comparison.championshipDelta.toFixed(1)}%</p>
            <p>Expected wins delta: {comparison.expectedWinsDelta >= 0 ? '+' : ''}{comparison.expectedWinsDelta.toFixed(1)}</p>
            <p>Seed edge (lower better): {comparison.expectedSeedDelta >= 0 ? '+' : ''}{comparison.expectedSeedDelta.toFixed(1)}</p>
          </div>
        )}
      </div>
      <LeagueForecastDashboard
        teamForecasts={forecasts}
        playoffSpots={selectedPlayoffSpots}
        leagueId={leagueId}
        season={activeSeason}
        week={activeWeek}
        teamNames={teamNames}
        teamRanks={teamRanks}
        aiSummary={aiSummary}
        generatedAt={generatedAt}
        avgConfidence={avgConfidence}
        simulationCount={2000}
      />
    </div>
  )
}
