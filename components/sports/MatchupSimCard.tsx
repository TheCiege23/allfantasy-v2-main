'use client'

import { useState } from 'react'
import { Loader2, Zap, MessageSquare } from 'lucide-react'
import type { SimMatchupResult } from '@/hooks/usePhase1Data'

export function MatchupSimCard({
  leagueId,
  teamAId,
  teamBId,
  teamAName,
  teamBName,
  sport = 'NFL',
  onAskChimmy,
}: {
  leagueId: string
  teamAId?: string
  teamBId?: string
  teamAName?: string
  teamBName?: string
  sport?: string
  onAskChimmy?: (prompt: string) => void
}) {
  const [result, setResult] = useState<SimMatchupResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runSim() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/sim-matchup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, teamAId, teamBId, sport }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error ?? 'Simulation failed')
        return
      }
      const data = await res.json()
      setResult(data.simulation)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  if (!result) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-6 text-center">
        <Zap className="mx-auto h-8 w-8 text-cyan-400/50" />
        <h3 className="mt-3 text-lg font-bold text-white">Matchup Simulator</h3>
        <p className="mt-1 text-xs text-white/40">
          {teamAName && teamBName ? `${teamAName} vs ${teamBName}` : 'Select a matchup to simulate'}
        </p>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          type="button"
          onClick={runSim}
          disabled={loading || !leagueId}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-500 px-5 py-2.5 text-[13px] font-bold text-black transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {loading ? 'Simulating...' : 'Run Simulation'}
        </button>
      </div>
    )
  }

  const probA = Math.round(result.winProbabilityA)
  const probB = Math.round(result.winProbabilityB)

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-[#0c0c1e] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[14px] font-bold text-white">Simulation Results</h3>
        <button
          type="button"
          onClick={runSim}
          disabled={loading}
          className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200"
        >
          {loading ? 'Re-running...' : 'Re-run'}
        </button>
      </div>

      {/* Win Probability Bar */}
      <div className="mb-4">
        <div className="mb-1 flex justify-between text-[11px] font-semibold">
          <span className="text-cyan-300">{teamAName ?? 'Team A'} {probA}%</span>
          <span className="text-purple-300">{teamBName ?? 'Team B'} {probB}%</span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="rounded-l-full bg-gradient-to-r from-cyan-500 to-cyan-400" style={{ width: `${probA}%` }} />
          <div className="rounded-r-full bg-gradient-to-l from-purple-500 to-purple-400" style={{ width: `${probB}%` }} />
        </div>
      </div>

      {/* Projected Scores */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white/[0.03] px-3 py-2 text-center">
          <p className="text-[11px] uppercase text-white/30">Projected</p>
          <p className="text-xl font-black text-cyan-300">{result.projectedScoreA?.toFixed(1) ?? '—'}</p>
        </div>
        <div className="rounded-xl bg-white/[0.03] px-3 py-2 text-center">
          <p className="text-[11px] uppercase text-white/30">Projected</p>
          <p className="text-xl font-black text-purple-300">{result.projectedScoreB?.toFixed(1) ?? '—'}</p>
        </div>
      </div>

      {/* Key Factors */}
      {result.keyFactors?.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/30">Key Factors</p>
          <ul className="space-y-0.5">
            {result.keyFactors.slice(0, 4).map((f, i) => (
              <li key={i} className="text-[11px] text-white/55">• {f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Swing Players */}
      {result.swingPlayers?.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/30">Swing Players</p>
          <div className="flex flex-wrap gap-1">
            {result.swingPlayers.slice(0, 5).map((p, i) => (
              <span key={i} className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {onAskChimmy && (
        <button
          type="button"
          onClick={() => onAskChimmy(`Analyze my matchup: ${teamAName ?? 'Team A'} vs ${teamBName ?? 'Team B'}`)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-300 hover:text-cyan-200"
        >
          <MessageSquare className="h-3.5 w-3.5" /> Ask Chimmy about this matchup
        </button>
      )}
    </div>
  )
}
