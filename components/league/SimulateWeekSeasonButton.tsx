'use client'

import { useState } from 'react'
import clsx from 'clsx'

/**
 * Simulate Week / Season Button — for regular users and commissioners.
 * Runs a quick simulation to show projected outcomes.
 *
 * Two modes:
 * - Simulate This Week: projects current week matchup outcome
 * - Simulate Rest of Season: projects final standings + playoff odds
 */
export function SimulateWeekSeasonButton({
  leagueId,
  currentWeek,
  isCommissioner,
}: {
  leagueId: string
  currentWeek: number
  isCommissioner: boolean
}) {
  const [mode, setMode] = useState<'idle' | 'week' | 'season'>('idle')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runSimulation(simMode: 'week' | 'season') {
    setMode(simMode)
    setRunning(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/admin/simulate-league', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          leagueId,
          simulationType: simMode,
          week: currentWeek,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Simulation failed' }))
        setError((err as { error?: string }).error ?? 'Simulation failed')
        return
      }

      const data = await res.json()
      setResult(data.report ?? data)
    } catch {
      setError('Could not run simulation. Try again.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-2">
      {/* Buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={running}
          onClick={() => void runSimulation('week')}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] font-semibold text-white/70 transition hover:bg-white/[0.06] disabled:opacity-40"
        >
          {running && mode === 'week' ? (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          ) : (
            '⚡'
          )}
          Simulate Week {currentWeek}
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => void runSimulation('season')}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] font-semibold text-white/70 transition hover:bg-white/[0.06] disabled:opacity-40"
        >
          {running && mode === 'season' ? (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
          ) : (
            '📊'
          )}
          Simulate Season
        </button>
      </div>

      {/* Error */}
      {error && (
        <p className="text-[11px] text-red-400">{error}</p>
      )}

      {/* Result */}
      {result && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="mb-2 text-[12px] font-bold text-white/70">
            {mode === 'week' ? `Week ${currentWeek} Projection` : 'Season Simulation'}
          </p>

          {mode === 'week' && result.weeklyEvents != null && (
            <div className="space-y-1 text-[11px] text-white/60">
              {(result.weeklyEvents as Array<{ description?: string }>).slice(0, 8).map((e, i) => (
                <p key={i}>{e.description ?? JSON.stringify(e)}</p>
              ))}
            </div>
          )}

          {mode === 'season' && (
            <div className="space-y-1 text-[11px] text-white/60">
              {result.champion != null && (
                <p className="text-[13px] font-bold text-amber-300">
                  🏆 Projected Champion: {String((result.champion as { name?: string })?.name ?? 'TBD')}
                </p>
              )}
              {result.playoffTeams != null && (
                <p>Playoff teams: {(result.playoffTeams as string[]).join(', ')}</p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setResult(null)}
            className="mt-2 text-[11px] text-white/30 hover:text-white/50"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
