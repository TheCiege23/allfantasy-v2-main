'use client'

/** Compact status card for the current Elimination Council vote window. Presentational. */
export function SurvivorVoteWindowCard({
  status,
  phase,
  week,
  votingDeadline,
  isRevealed,
}: {
  status: string | null
  phase: string | null
  week: number | null
  votingDeadline: string | null
  isRevealed: boolean
}) {
  const label =
    isRevealed
      ? 'Revealed'
      : status === 'voting_open'
        ? 'Voting Open'
        : status === 'closed'
          ? 'Window Closed'
          : status === 'scheduled'
            ? 'Scheduled'
            : status === 'tie_pending'
              ? 'Tie — Pending'
              : status === 'cancelled'
                ? 'Cancelled'
                : 'Not started'
  const tone =
    status === 'voting_open' ? 'bg-emerald-500/15 text-emerald-200' : isRevealed ? 'bg-orange-500/15 text-orange-200' : 'bg-neutral-800 text-neutral-300'
  const deadline = votingDeadline ? new Date(votingDeadline) : null

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-neutral-800 bg-neutral-950 p-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          Elimination Council{week != null ? ` · Week ${week}` : ''}{phase ? ` · ${phase === 'merge' ? 'Merge' : 'Pre-merge'}` : ''}
        </div>
        <div className="mt-1 text-sm font-semibold text-white">{label}</div>
      </div>
      {deadline ? (
        <div className="text-right text-xs text-neutral-400">
          <div className="uppercase tracking-wide text-neutral-500">Deadline</div>
          <div className="mt-0.5">{deadline.toLocaleString()}</div>
        </div>
      ) : null}
    </div>
  )
}

export default SurvivorVoteWindowCard
