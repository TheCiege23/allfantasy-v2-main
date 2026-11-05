import type { ReactNode } from 'react'

import './af-primitives.css'

export type StatTone = 'warn' | 'accent' | 'good' | 'bad'

export type StatItem = {
  key: string
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: StatTone
  testId?: string
}

/**
 * A row of stat tiles (label, big value, one-line sub) laid out by COUNT against the strip's own
 * width — every tile on one row from 760px, full rows only below that, an odd last tile spanning the
 * row on a phone (af-primitives.css). Nothing renders for an empty list: a strip of no numbers is
 * not a summary of anything.
 */
export function StatStrip({
  items,
  ariaLabel,
  className,
  testId,
}: {
  items: StatItem[]
  ariaLabel?: string
  className?: string
  testId?: string
}) {
  if (items.length === 0) return null
  return (
    <section className={['af-pg-stats-wrap', className].filter(Boolean).join(' ')} aria-label={ariaLabel} data-testid={testId}>
      <div className="af-pg-stats" data-count={items.length}>
        {items.map((item) => (
          <div key={item.key} className="af-pg-stat" data-tone={item.tone} data-testid={item.testId}>
            <span className="af-pg-stat-label">{item.label}</span>
            <span className="af-pg-stat-value af-num">{item.value}</span>
            {item.sub != null && item.sub !== '' ? <span className="af-pg-stat-sub">{item.sub}</span> : null}
          </div>
        ))}
      </div>
    </section>
  )
}
