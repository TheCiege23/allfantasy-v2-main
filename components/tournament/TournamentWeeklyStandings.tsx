'use client'

import { useCallback, useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, Trophy, AlertTriangle } from 'lucide-react'

interface WeeklyStandingRow {
  userId: string
  displayName: string
  teamName: string
  leagueName: string
  conference: string
  weeklyScore: number
  weeklyLeagueRank: number
  weeklyConferenceRank: number
  weeklyGlobalRank: number
  previousGlobalRank: number | null
  record: string
  pointsFor: number
  globalRank: number
  status: 'qualified' | 'safe' | 'bubble' | 'out' | 'advanced' | 'eliminated' | 'awaiting_redraft' | 'championship'
  cutlineDistance: number
}

interface TournamentWeeklyStandingsProps {
  tournamentId: string
  week?: number
}

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  qualified: { label: 'QUALIFIED', color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
  safe: { label: 'SAFE', color: 'text-emerald-300/70', bg: 'bg-emerald-300/5' },
  bubble: { label: 'BUBBLE', color: 'text-amber-400', bg: 'bg-amber-400/10' },
  out: { label: 'OUT', color: 'text-red-400/70', bg: 'bg-red-400/5' },
  advanced: { label: 'ADVANCED', color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
  eliminated: { label: 'ELIMINATED', color: 'text-red-500', bg: 'bg-red-500/10' },
  awaiting_redraft: { label: 'REDRAFT', color: 'text-violet-400', bg: 'bg-violet-400/10' },
  championship: { label: 'FINALS', color: 'text-amber-300', bg: 'bg-amber-300/10' },
}

export function TournamentWeeklyStandings({ tournamentId, week }: TournamentWeeklyStandingsProps) {
  const [standings, setStandings] = useState<WeeklyStandingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [currentWeek, setCurrentWeek] = useState(week ?? 1)

  const fetchStandings = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/tournament/${tournamentId}/standings?week=${currentWeek}`)
      if (res.ok) {
        const data = await res.json()
        setStandings(data.standings ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [tournamentId, currentWeek])

  useEffect(() => { fetchStandings() }, [fetchStandings])

  if (loading) return <div className="text-sm text-white/40">Loading standings...</div>

  // Find cutline
  const cutlineIdx = standings.findIndex((s) => s.status === 'bubble' || s.status === 'out')
  const topScorer = standings.length > 0 ? standings.reduce((best, s) => s.weeklyScore > best.weeklyScore ? s : best, standings[0]!) : null

  return (
    <div className="space-y-4">
      {/* Week selector + top scorer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => setCurrentWeek((w) => Math.max(1, w - 1))} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/50 hover:border-white/20">←</button>
          <span className="text-sm font-semibold text-white/80">Week {currentWeek}</span>
          <button onClick={() => setCurrentWeek((w) => w + 1)} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/50 hover:border-white/20">→</button>
        </div>
        {topScorer && (
          <div className="flex items-center gap-1.5 text-xs text-amber-300/70">
            <Trophy className="h-3 w-3" />
            Top: {topScorer.displayName} ({topScorer.weeklyScore.toFixed(1)})
          </div>
        )}
      </div>

      {/* Standings table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 text-white/40">
              <th className="px-2 py-2 text-left">#</th>
              <th className="px-2 py-2 text-left">Player</th>
              <th className="px-2 py-2 text-left hidden sm:table-cell">League</th>
              <th className="px-2 py-2 text-left hidden md:table-cell">Conf</th>
              <th className="px-2 py-2 text-right">Week</th>
              <th className="px-2 py-2 text-center hidden sm:table-cell">Move</th>
              <th className="px-2 py-2 text-left">Record</th>
              <th className="px-2 py-2 text-right hidden sm:table-cell">PF</th>
              <th className="px-2 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, i) => {
              const isCutline = i === cutlineIdx
              const rankChange = row.previousGlobalRank != null ? row.previousGlobalRank - row.globalRank : 0
              const statusStyle = STATUS_STYLES[row.status] ?? STATUS_STYLES.out!

              return (
                <>
                  {isCutline && (
                    <tr key={`cutline-${i}`}>
                      <td colSpan={9} className="py-1">
                        <div className="flex items-center gap-2 text-[11px] text-amber-400/60">
                          <div className="flex-1 border-t border-amber-400/30" />
                          <AlertTriangle className="h-3 w-3" />
                          <span>CUTLINE</span>
                          <div className="flex-1 border-t border-amber-400/30" />
                        </div>
                      </td>
                    </tr>
                  )}
                  <tr key={row.userId} className={`border-b border-white/5 ${row.status === 'eliminated' ? 'opacity-40' : ''}`}>
                    <td className="px-2 py-1.5 text-white/40 font-bold">{row.globalRank}</td>
                    <td className="px-2 py-1.5">
                      <div className="text-white/80 font-medium">{row.displayName}</div>
                      <div className="text-[11px] text-white/30 sm:hidden">{row.leagueName}</div>
                    </td>
                    <td className="px-2 py-1.5 text-white/50 hidden sm:table-cell">{row.leagueName}</td>
                    <td className="px-2 py-1.5 text-white/40 hidden md:table-cell">{row.conference}</td>
                    <td className="px-2 py-1.5 text-right font-bold text-white/80">{row.weeklyScore.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-center hidden sm:table-cell">
                      {rankChange > 0 && <span className="flex items-center justify-center gap-0.5 text-emerald-400"><TrendingUp className="h-3 w-3" />{rankChange}</span>}
                      {rankChange < 0 && <span className="flex items-center justify-center gap-0.5 text-red-400"><TrendingDown className="h-3 w-3" />{Math.abs(rankChange)}</span>}
                      {rankChange === 0 && <Minus className="h-3 w-3 text-white/20 mx-auto" />}
                    </td>
                    <td className="px-2 py-1.5 text-white/60">{row.record}</td>
                    <td className="px-2 py-1.5 text-right text-white/40 hidden sm:table-cell">{row.pointsFor.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`inline-block rounded-full px-1.5 py-0.5 text-[11px] font-bold ${statusStyle.color} ${statusStyle.bg}`}>
                        {statusStyle.label}
                      </span>
                    </td>
                  </tr>
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {standings.length === 0 && <div className="text-sm text-white/40 text-center py-4">No standings data for this week.</div>}
    </div>
  )
}
