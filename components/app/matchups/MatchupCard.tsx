"use client"

import { type ReactNode } from "react"
import { ChevronRight } from "lucide-react"

export type MatchupSummary = {
  id: string
  teamAId?: string
  teamBId?: string
  weekOrRound?: number
  sport?: string
  teamA: string
  teamB: string
  scoreA: number
  scoreB: number
  projA: number
  projB: number
  winProbA: number
  remainingA: number
  remainingB: number
}

export function MatchupCard({
  matchup,
  onClick,
  footer,
}: {
  matchup: MatchupSummary
  onClick?: () => void
  footer?: ReactNode
}) {
  const favoredA = matchup.winProbA >= 0.5

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`matchup-card-${matchup.id}`}
      aria-label={`${matchup.teamA} versus ${matchup.teamB}`}
      className="group flex w-full flex-col gap-1 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-left text-xs transition hover:border-cyan-400/50 hover:bg-black/60"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-white">
            {matchup.teamA} <span className="text-white/45">vs</span> {matchup.teamB}
          </p>
          <p className="mt-0.5 text-[11px] text-white/60">
            Current:{" "}
            <span className="font-semibold text-emerald-200">
              {matchup.scoreA.toFixed(1)} – {matchup.scoreB.toFixed(1)}
            </span>
          </p>
          <p className="text-[11px] text-white/55">
            Projected: {matchup.projA.toFixed(1)} – {matchup.projB.toFixed(1)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <p className="text-[11px] text-white/60">
              Win prob {favoredA ? "A" : "B"}
            </p>
            <p className="text-[11px] font-semibold text-emerald-300">
              {(favoredA ? matchup.winProbA : 1 - matchup.winProbA) * 100 >= 99
                ? "99+%"
                : `${((favoredA ? matchup.winProbA : 1 - matchup.winProbA) * 100).toFixed(0)}%`}
            </p>
            <p className="mt-0.5 text-[11px] text-white/55">
              Rem: {matchup.remainingA} vs {matchup.remainingB}
            </p>
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-white/40 transition group-hover:translate-x-0.5" />
        </div>
      </div>
      {footer && <div className="mt-1">{footer}</div>}
    </button>
  )
}

