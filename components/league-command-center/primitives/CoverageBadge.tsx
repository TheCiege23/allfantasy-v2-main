/**
 * Signal-coverage qualifier for a composite score.
 *
 * The league-health engine scores 22 inputs, but only some are derived from real
 * behavioral data — the rest fall back to schema defaults, and those defaults are
 * flattering (`lineupSubmissionRate: 1.0`, `abandonedTeams: 0`, `disputeCount: 0`).
 * `resolveDecisionOsLeagueHealth` reports which is which via `fieldProvenance`
 * precisely so callers do not present a partly-defaulted composite as a fully
 * measured one.
 *
 * This badge is how that gets said out loud. It is deliberately quiet — a caveat
 * attached to a number, not a headline of its own — but it is never omitted when
 * coverage is partial, because a score with unstated coverage is the thing this
 * whole surface is trying not to ship.
 */
export function CoverageBadge({
  real,
  total,
  className,
}: {
  real: number
  total: number
  className?: string
}) {
  if (total <= 0) return null

  const isComplete = real >= total

  return (
    <span
      className={['af-cc-coverage', className].filter(Boolean).join(' ')}
      title={
        isComplete
          ? `All ${total} scoring inputs are measured from this league's real activity.`
          : `${real} of ${total} scoring inputs are measured from this league's real activity. ` +
            `The rest use league-default assumptions, so treat this as directional.`
      }
    >
      <i className="ph ph-chart-donut" aria-hidden="true" />
      {real}/{total} measured
    </span>
  )
}

export default CoverageBadge
