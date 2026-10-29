'use client'

import { useState, useCallback } from 'react'
import { FlaskConical, Calendar, Trophy, Castle, Loader2 } from 'lucide-react'
import { getSportOptionsForSimulation } from '@/lib/matchup-simulator'

type Tab = 'season' | 'playoffs' | 'dynasty'

export default function SimulationLabPage() {
  const [tab, setTab] = useState<Tab>('season')

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-2">
        <FlaskConical className="h-6 w-6 text-violet-400" />
        <h1 className="text-2xl font-semibold text-white">Simulation Lab</h1>
      </div>
      <p className="mb-6 text-sm text-white/60">
        Sandbox to simulate seasons, playoffs, and dynasty outcomes. No league required — use mean (and optional stdDev) for each team.
      </p>

      <div className="mb-6 flex gap-2">
        {(
          [
            { id: 'season' as Tab, label: 'Season', icon: Calendar },
            { id: 'playoffs' as Tab, label: 'Playoffs', icon: Trophy },
            { id: 'dynasty' as Tab, label: 'Dynasty', icon: Castle },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition ${
              tab === id
                ? 'border-violet-500 bg-violet-500/20 text-violet-200'
                : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'season' && <SeasonSimPanel />}
      {tab === 'playoffs' && <PlayoffsSimPanel />}
      {tab === 'dynasty' && <DynastySimPanel />}
    </main>
  )
}

function SeasonSimPanel() {
  const [sport, setSport] = useState('NFL')
  const [teamMean, setTeamMean] = useState('100')
  const [teamStd, setTeamStd] = useState('12')
  const [opponentsText, setOpponentsText] = useState('98, 95, 94, 92, 90, 88, 85, 82, 80, 78')
  const [playoffSpots, setPlayoffSpots] = useState('4')
  const [iterations, setIterations] = useState('2000')
  const [result, setResult] = useState<{
    sport: string
    expectedWins: number
    playoffProbability: number
    byeWeekProbability: number
    iterations: number
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    const opponents = opponentsText
      .split(/[\s,]+/)
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !Number.isNaN(n))
    if (opponents.length === 0) {
      setError('Enter at least one opponent mean (comma-separated)')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/simulation-lab/season', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport,
          team: { mean: parseFloat(teamMean) || 100, stdDev: parseFloat(teamStd) || 12 },
          opponents: opponents.map((mean) => ({ mean })),
          playoffSpots: parseInt(playoffSpots, 10) || 4,
          byeSpots: 0,
          iterations: parseInt(iterations, 10) || 2000,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Simulation failed (${res.status})`)
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [sport, teamMean, teamStd, opponentsText, playoffSpots, iterations])

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="mb-4 text-lg font-semibold text-white">Season simulation</h2>
      <p className="mb-4 text-xs text-white/50">
        Your team vs opponents (expected points mean). Results: expected wins, playoff %, bye %.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-white/70">Sport</label>
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            aria-label="Season simulation sport"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
          >
            {getSportOptionsForSimulation().map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/70">Your team mean</label>
          <input
            type="number"
            value={teamMean}
            onChange={(e) => setTeamMean(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/70">Your team stdDev</label>
          <input
            type="number"
            value={teamStd}
            onChange={(e) => setTeamStd(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-white/70">Opponent means (comma-separated)</label>
          <input
            type="text"
            value={opponentsText}
            onChange={(e) => setOpponentsText(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
            placeholder="98, 95, 94, ..."
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/70">Playoff spots</label>
          <input
            type="number"
            value={playoffSpots}
            onChange={(e) => setPlayoffSpots(e.target.value)}
            min={1}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/70">Iterations</label>
          <input
            type="number"
            value={iterations}
            onChange={(e) => setIterations(e.target.value)}
            aria-label="Season simulation iterations"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={run}
        disabled={loading}
        aria-label="Run season simulation"
        className="mt-4 flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Run season sim
      </button>
      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
      {result && (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <p className="text-white/70">Sport: <strong>{result.sport}</strong></p>
          <p className="text-white">Expected wins: <strong>{result.expectedWins}</strong></p>
          <p className="text-white">Playoff probability: <strong>{(result.playoffProbability * 100).toFixed(1)}%</strong></p>
          <p className="text-white">Bye probability: <strong>{(result.byeWeekProbability * 100).toFixed(1)}%</strong></p>
          <p className="text-xs text-white/50">({result.iterations} iterations)</p>
        </div>
      )}
    </section>
  )
}

function PlayoffsSimPanel() {
  const [sport, setSport] = useState('NFL')
  const [teamsText, setTeamsText] = useState('105, 102, 98, 95, 92, 90')
  const [targetIndex, setTargetIndex] = useState('0')
  const [iterations, setIterations] = useState('3000')
  const [result, setResult] = useState<{
    sport: string
    championshipProbability: number
    finalistProbability: number
    iterations: number
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    const means = teamsText
      .split(/[\s,]+/)
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !Number.isNaN(n))
    if (means.length < 2) {
      setError('Enter at least 2 team means (comma-separated, seed order)')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/simulation-lab/playoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport,
          teams: means.map((mean, i) => ({ mean, name: `Team ${i + 1}` })),
          targetTeamIndex: parseInt(targetIndex, 10) || 0,
          iterations: parseInt(iterations, 10) || 3000,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Simulation failed (${res.status})`)
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [sport, teamsText, targetIndex, iterations])

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="mb-4 text-lg font-semibold text-white">Playoff simulation</h2>
      <p className="mb-4 text-xs text-white/50">
        Bracket of teams (mean PPG). Target team index = which team (0-based) to get odds for.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-white/70">Sport</label>
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            aria-label="Playoff simulation sport"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
          >
            {getSportOptionsForSimulation().map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-white/70">Team means, seed order (comma-separated)</label>
          <input
            type="text"
            value={teamsText}
            onChange={(e) => setTeamsText(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
            placeholder="105, 102, 98, ..."
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/70">Target team index (0 = 1st seed)</label>
          <input
            type="number"
            value={targetIndex}
            onChange={(e) => setTargetIndex(e.target.value)}
            min={0}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/70">Iterations</label>
          <input
            type="number"
            value={iterations}
            onChange={(e) => setIterations(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={run}
        disabled={loading}
        aria-label="Run playoff simulation"
        className="mt-4 flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Run playoff sim
      </button>
      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
      {result && (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <p className="text-white/70">Sport: <strong>{result.sport}</strong></p>
          <p className="text-white">Championship probability: <strong>{(result.championshipProbability * 100).toFixed(1)}%</strong></p>
          <p className="text-white">Finalist probability: <strong>{(result.finalistProbability * 100).toFixed(1)}%</strong></p>
          <p className="text-xs text-white/50">({result.iterations} iterations)</p>
        </div>
      )}
    </section>
  )
}

function DynastySimPanel() {
  const [sport, setSport] = useState('NFL')
  const [teamsText, setTeamsText] = useState('100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 80, 78')
  const [seasons, setSeasons] = useState('50')
  const [playoffSpots, setPlayoffSpots] = useState('6')
  const [iterationsPerSeason, setIterationsPerSeason] = useState('5')
  const [result, setResult] = useState<{
    sport: string
    seasonsRun: number
    iterationsPerSeason: number
    outcomes: Array<{
      teamIndex: number
      name?: string
      championships: number
      totalWins: number
      avgFinish: number
      playoffAppearances: number
    }>
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    const means = teamsText
      .split(/[\s,]+/)
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !Number.isNaN(n))
    if (means.length < 2) {
      setError('Enter at least 2 team means (comma-separated)')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/simulation-lab/dynasty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport,
          teams: means.map((mean, i) => ({ mean, name: `Team ${i + 1}` })),
          seasons: parseInt(seasons, 10) || 50,
          playoffSpots: parseInt(playoffSpots, 10) || 6,
          iterationsPerSeason: parseInt(iterationsPerSeason, 10) || 5,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Simulation failed (${res.status})`)
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [sport, teamsText, seasons, playoffSpots, iterationsPerSeason])

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="mb-4 text-lg font-semibold text-white">Dynasty simulation</h2>
      <p className="mb-4 text-xs text-white/50">
        Run many seasons: round-robin + playoff bracket each season. See championships, wins, and average finish per team.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-white/70">Sport</label>
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            aria-label="Dynasty simulation sport"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
          >
            {getSportOptionsForSimulation().map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-white/70">Team means (comma-separated)</label>
          <input
            type="text"
            value={teamsText}
            onChange={(e) => setTeamsText(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
            placeholder="100, 98, 96, ..."
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/70">Seasons to run</label>
          <input
            type="number"
            value={seasons}
            onChange={(e) => setSeasons(e.target.value)}
            min={1}
            max={200}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/70">Playoff spots per season</label>
          <input
            type="number"
            value={playoffSpots}
            onChange={(e) => setPlayoffSpots(e.target.value)}
            min={1}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/70">Iterations per season</label>
          <input
            type="number"
            value={iterationsPerSeason}
            onChange={(e) => setIterationsPerSeason(e.target.value)}
            min={1}
            max={500}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={run}
        disabled={loading}
        aria-label="Run dynasty simulation"
        className="mt-4 flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Run dynasty sim
      </button>
      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
      {result && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-black/20">
          <p className="p-2 text-xs text-white/60">Sport: {result.sport}</p>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="p-2 font-medium text-white/80">Team</th>
                <th className="p-2 font-medium text-white/80">Championships</th>
                <th className="p-2 font-medium text-white/80">Avg wins</th>
                <th className="p-2 font-medium text-white/80">Avg finish</th>
                <th className="p-2 font-medium text-white/80">Playoff %</th>
              </tr>
            </thead>
            <tbody>
              {result.outcomes.map((o) => (
                <tr key={o.teamIndex} className="border-b border-white/5">
                  <td className="p-2 text-white/90">{o.name ?? `Team ${o.teamIndex + 1}`}</td>
                  <td className="p-2 text-amber-300">{o.championships}</td>
                  <td className="p-2 text-white/80">{o.totalWins.toFixed(1)}</td>
                  <td className="p-2 text-white/80">{o.avgFinish.toFixed(1)}</td>
                  <td className="p-2 text-white/80">
                    {((o.playoffAppearances / (result.seasonsRun * result.iterationsPerSeason)) * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-2 text-xs text-white/50">
            {result.seasonsRun} seasons x {result.iterationsPerSeason} iterations/season
          </p>
        </div>
      )}
    </section>
  )
}
