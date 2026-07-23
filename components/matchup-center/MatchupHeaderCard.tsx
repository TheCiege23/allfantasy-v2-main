'use client'

import type { MatchupSidePayload } from '@/lib/matchup-center/types'

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

export function MatchupHeaderCard({
  left,
  right,
  matchupStatus,
  winProbabilityLeft,
  conceptOverlay,
}: {
  left: MatchupSidePayload
  right: MatchupSidePayload
  matchupStatus: string
  winProbabilityLeft: number | null
  conceptOverlay: string | null
}) {
  const statusLabel =
    matchupStatus === 'final' ? 'Final' : matchupStatus === 'live' ? 'Live' : 'Upcoming'

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.12] bg-gradient-to-b from-[#0a1228] to-[#060b18] shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
      {conceptOverlay ? (
        <div className="border-b border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-center text-[11px] font-medium text-amber-100/90">
          {conceptOverlay}
        </div>
      ) : null}
      <div className="flex items-stretch justify-between gap-2 px-3 pt-4 pb-3">
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-[13px] font-bold text-white">{left.teamName}</div>
          <div className="mt-1 text-2xl font-black tabular-nums text-cyan-300">{left.totalPoints.toFixed(2)}</div>
          <div className="text-[10px] text-white/45">Proj {left.projectedTotal.toFixed(1)}</div>
          <div className="mt-1 text-[11px] text-white/55">
            {left.record.wins}-{left.record.losses}
            {left.record.ties ? `-${left.record.ties}` : ''} · {pct(left.winPct)}
          </div>
          <div className="mt-1 text-[10px] text-white/40">{left.remainingStarters} left to play</div>
        </div>
        <div className="flex flex-col items-center justify-center px-1">
          <span className="rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white/55">
            {statusLabel}
          </span>
        </div>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-[13px] font-bold text-white">{right.teamName}</div>
          <div className="mt-1 text-2xl font-black tabular-nums text-cyan-300">{right.totalPoints.toFixed(2)}</div>
          <div className="text-[10px] text-white/45">Proj {right.projectedTotal.toFixed(1)}</div>
          <div className="mt-1 text-[11px] text-white/55">
            {right.record.wins}-{right.record.losses}
            {right.record.ties ? `-${right.record.ties}` : ''} · {pct(right.winPct)}
          </div>
          <div className="mt-1 text-[10px] text-white/40">{right.remainingStarters} left to play</div>
        </div>
      </div>
      {winProbabilityLeft != null ? (
        <div className="border-t border-white/[0.06] px-4 py-2">
          <div className="mb-1 flex justify-between text-[9px] text-white/40">
            <span>{pct(winProbabilityLeft)} win prob</span>
            <span>{pct(1 - winProbabilityLeft)} win prob</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-[width] duration-700"
              style={{ width: `${(winProbabilityLeft * 100).toFixed(1)}%` }}
              role="meter"
              aria-valuenow={Math.round(winProbabilityLeft * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${left.teamName} win probability`}
            />
          </div>
        </div>
      ) : (
        <div className="border-t border-white/[0.06] px-4 py-2 text-[9px] text-white/40">
          Win probability unavailable — real projections are missing for some starters.
        </div>
      )}
    </div>
  )
}
