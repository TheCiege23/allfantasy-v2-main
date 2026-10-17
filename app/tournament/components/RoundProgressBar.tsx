'use client'

import type { SerializedRound } from '@/lib/tournament/tournamentPageData'

export function RoundProgressBar({
  rounds,
  currentRoundNumber,
  remainingByRound,
}: {
  rounds: SerializedRound[]
  currentRoundNumber: number
  remainingByRound?: Record<number, number>
}) {
  return (
    <div className="tournament-panel overflow-x-auto p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--tournament-text-dim)]">
        Tournament arc
      </p>
      <div className="flex min-w-[520px] items-center gap-1">
        {rounds.map((r, i) => {
          const done = r.roundNumber < currentRoundNumber
          const current = r.roundNumber === currentRoundNumber
          const count = remainingByRound?.[r.roundNumber]
          return (
            <div key={r.id} className="flex min-w-0 flex-1 items-center">
              <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div
                  className={`relative flex h-10 w-full max-w-[120px] items-center justify-center rounded-lg border text-center text-[11px] font-bold leading-tight ${
                    done
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100'
                      : current
                        ? 'tournament-pulse-dot border-[var(--tournament-active)] bg-cyan-500/15 text-white'
                        : 'border-[var(--tournament-border)] bg-black/20 text-[var(--tournament-text-dim)]'
                  }`}
                >
                  {r.roundLabel}
                  {count != null ? (
                    <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-[var(--tournament-text-dim)]">
                      {count} left
                    </span>
                  ) : null}
                </div>
              </div>
              {i < rounds.length - 1 ? (
                <div
                  className={`mx-0.5 h-0.5 w-4 shrink-0 rounded ${done ? 'bg-cyan-500/50' : 'bg-white/10'}`}
                />
              ) : null}
            </div>
          )
        })}
        <div className="ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--tournament-gold)]/40 bg-yellow-500/10 text-lg">
          🏆
        </div>
      </div>
    </div>
  )
}
