'use client'

import { useCallback, useEffect, useState } from 'react'
import { Trophy, Users, ChevronRight } from 'lucide-react'

interface RoundGroup {
  roundNumber: number
  roundLabel: string
  status: 'completed' | 'active' | 'upcoming'
  leagues: Array<{ name: string; teamsRemaining: number; status: string }>
  advancersCount: number
  eliminatedCount: number
}

interface TournamentBracketProgressProps {
  tournamentId: string
}

export function TournamentBracketProgress({ tournamentId }: TournamentBracketProgressProps) {
  const [rounds, setRounds] = useState<RoundGroup[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/tournament/${tournamentId}/bracket`)
      .then((r) => r.json())
      .then((d) => setRounds(d.rounds ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tournamentId])

  if (loading) return <div className="text-sm text-white/40">Loading bracket...</div>

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold text-white/80">Championship Path</div>

      {/* Horizontal progress */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {rounds.map((round, i) => (
          <div key={round.roundNumber} className="flex items-center gap-1">
            <div className={`rounded-xl border px-4 py-3 min-w-[120px] ${
              round.status === 'active' ? 'border-purple-400/40 bg-purple-400/10' :
              round.status === 'completed' ? 'border-emerald-400/20 bg-emerald-400/5' :
              'border-white/10 bg-white/[0.02]'
            }`}>
              <div className="text-[11px] uppercase tracking-wide text-white/40">{round.roundLabel}</div>
              <div className="text-xs font-semibold text-white mt-1">
                <Users className="inline h-3 w-3 mr-1" />
                {round.leagues.length} league{round.leagues.length !== 1 ? 's' : ''}
              </div>
              {round.status === 'completed' && (
                <div className="text-[11px] text-emerald-400/60 mt-1">
                  {round.advancersCount} advanced · {round.eliminatedCount} out
                </div>
              )}
              {round.status === 'active' && (
                <div className="text-[11px] text-purple-300/60 mt-1">In progress</div>
              )}
            </div>
            {i < rounds.length - 1 && <ChevronRight className="h-4 w-4 text-white/20 flex-shrink-0" />}
          </div>
        ))}
        <ChevronRight className="h-4 w-4 text-white/20 flex-shrink-0" />
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 min-w-[120px]">
          <Trophy className="h-5 w-5 text-amber-400 mb-1" />
          <div className="text-xs font-bold text-amber-200">Champion</div>
        </div>
      </div>

      {/* Round details */}
      <div className="space-y-3">
        {rounds.map((round) => (
          <details key={round.roundNumber} open={round.status === 'active'}>
            <summary className={`cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium ${
              round.status === 'active' ? 'border-purple-400/30 bg-purple-400/5 text-white' :
              round.status === 'completed' ? 'border-emerald-400/20 text-white/70' :
              'border-white/10 text-white/50'
            }`}>
              {round.roundLabel} — {round.leagues.length} leagues
              {round.status === 'completed' && <span className="ml-2 text-xs text-emerald-400/60">Complete</span>}
              {round.status === 'active' && <span className="ml-2 text-xs text-purple-300/60">Active</span>}
            </summary>
            <div className="mt-2 grid gap-1.5 pl-4">
              {round.leagues.map((league) => (
                <div key={league.name} className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-1.5 text-xs">
                  <span className="text-white/70">{league.name}</span>
                  <span className="text-white/40">{league.teamsRemaining} teams</span>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
