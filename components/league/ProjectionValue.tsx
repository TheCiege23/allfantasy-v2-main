'use client'

/**
 * Honest projection cell (Honesty Pack 1A): renders a real value, or an explicit
 * unavailable "—" — never a fabricated baseline, never a silent 0 for missing data.
 * A real zero projection renders as 0.0.
 */
import type { ProjectionAvailability } from '@/lib/league/dataHonesty'

export function ProjectionValue({
  projection,
  suffix = '',
  className,
}: {
  projection: ProjectionAvailability
  suffix?: string
  className?: string
}) {
  if (projection.state === 'unavailable') {
    return (
      <span
        aria-label="Projection unavailable"
        title="Projection unavailable"
        className={className ?? 'text-xs text-white/35'}
      >
        —
      </span>
    )
  }
  return (
    <span className={className ?? 'text-xs text-white/55'}>
      {suffix ? `${projection.value.toFixed(1)} ${suffix}` : projection.value.toFixed(1)}
      {projection.source === 'allfantasy-derived' ? (
        <span className="sr-only">AllFantasy derived projection</span>
      ) : null}
    </span>
  )
}
