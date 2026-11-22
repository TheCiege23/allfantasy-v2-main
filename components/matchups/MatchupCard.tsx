'use client'

import Link from 'next/link'
import { Trophy } from 'lucide-react'
import TeamScoreBreakdown from '@/components/matchups/TeamScoreBreakdown'

type MatchupSide = {
  rosterId: string
  teamName: string
  totalPoints: number
  winLoss: string | null
}

type Props = {
  leagueId: string
  season: number
  week: number
  home: MatchupSide
  away: MatchupSide
  status?: string
}

export default function MatchupCard({ leagueId, season, week, home, away, status }: Props) {
  const homeWins = home.winLoss === 'W' || (home.totalPoints > away.totalPoints && home.winLoss !== 'T')
  const awayWins = away.winLoss === 'W' || (away.totalPoints > home.totalPoints && away.winLoss !== 'T')
  const tie = home.winLoss === 'T' || home.totalPoints === away.totalPoints

  return (
    <div
      className="overflow-hidden rounded-2xl border border-white/10 bg-[#0a1228]/90 shadow-lg shadow-black/30"
      data-testid="matchup-card"
    >
      <div className="flex items-center justify-between border-b border-white/10 bg-black/25 px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
          Week {week}
          {status === 'final' ? (
            <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-200">Final</span>
          ) : (
            <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-100">Live</span>
          )}
        </span>
        {tie ? (
          <span className="text-[11px] text-white/50">Tie</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-200/90">
            <Trophy className="h-3.5 w-3.5" />
            {homeWins ? home.teamName : awayWins ? away.teamName : '—'}
          </span>
        )}
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2">
        <div
          className={`rounded-xl border p-3 ${
            homeWins && !tie ? 'border-cyan-400/40 bg-cyan-500/10' : 'border-white/10 bg-black/20'
          }`}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-white">{home.teamName}</p>
              <p className="text-[11px] text-white/45">{home.winLoss ?? '—'}</p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-white">{home.totalPoints.toFixed(2)}</p>
          </div>
          <TeamScoreBreakdown leagueId={leagueId} rosterId={home.rosterId} season={season} week={week} />
        </div>

        <div
          className={`rounded-xl border p-3 ${
            awayWins && !tie ? 'border-cyan-400/40 bg-cyan-500/10' : 'border-white/10 bg-black/20'
          }`}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-white">{away.teamName}</p>
              <p className="text-[11px] text-white/45">{away.winLoss ?? '—'}</p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-white">{away.totalPoints.toFixed(2)}</p>
          </div>
          <TeamScoreBreakdown leagueId={leagueId} rosterId={away.rosterId} season={season} week={week} />
        </div>
      </div>

      <div className="border-t border-white/5 px-4 py-2 text-center">
        <Link
          href={`/league/${leagueId}/standings`}
          className="text-[11px] text-cyan-300/90 hover:text-cyan-200"
        >
          Full standings
        </Link>
      </div>
    </div>
  )
}
