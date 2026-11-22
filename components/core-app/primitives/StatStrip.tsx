import type { ReactNode } from 'react'

import './af-primitives.css'

type StatTone = 'warn' | 'accent' | 'good' | 'bad'

/**
 * Which way a tile's figure moved since the last reading. The arrow is drawn, and coloured by
 * direction, but it is decoration: `label` is what a screen reader hears ("up 2 places"), so the
 * movement is never carried by colour or by a glyph alone.
 */
export type StatMovement = {
  direction: 'up' | 'down' | 'flat'
  /** The sentence for assistive tech — required, in the reader's language. */
  label: string
  /** The visible amount beside the arrow ("2"), when there is one. */
  amount?: ReactNode
}

export type StatItem = {
  key: string
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: StatTone
  testId?: string
  /**
   * No figure to show: the value reads "—" and the tile is stamped `data-missing`. Pair it with
   * `reason` so a missing tile says why rather than showing a bare dash.
   */
  missing?: boolean
  /** A muted explanatory line under the sub — the loader's reason for a missing tile, or a note. */
  reason?: ReactNode
  movement?: StatMovement
  /** A screen's own tile class, carried through for its identity styling and its tests. */
  className?: string
  /** `data-*` hooks a screen's stylesheet or tests key on (`{ tile: 'faab' }` → `data-tile="faab"`). */
  data?: Record<string, string | undefined>
  /** Decoration after the text lines (a redraft FAAB bar). Keep it aria-hidden if it restates a figure. */
  extra?: ReactNode
}

const ARROW: Record<StatMovement['direction'], string> = { up: '▲', down: '▼', flat: '–' }

function dataAttrs(data: StatItem['data']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data ?? {})) if (v != null) out[`data-${k}`] = v
  return out
}

/**
 * A row of stat tiles (label, big value, one-line sub) laid out by COUNT against the strip's own
 * width — every tile on one row from 760px, full rows only below that, an odd last tile spanning the
 * row on a phone (af-primitives.css). Nothing renders for an empty list: a strip of no numbers is
 * not a summary of anything.
 *
 * `order="value-first"` is for tiles whose label reads as the rest of a sentence after the number
 * ("3 · already clinched"): the figure leads in the DOM as well as on screen, so it is read first.
 */
export function StatStrip({
  items,
  ariaLabel,
  className,
  testId,
  order = 'label-first',
}: {
  items: StatItem[]
  ariaLabel?: string
  className?: string
  testId?: string
  order?: 'label-first' | 'value-first'
}) {
  if (items.length === 0) return null
  return (
    <section className={['af-pg-stats-wrap', className].filter(Boolean).join(' ')} aria-label={ariaLabel} data-testid={testId}>
      <div className="af-pg-stats" data-count={items.length} data-order={order === 'value-first' ? 'value-first' : undefined}>
        {items.map((item) => {
          const label = <span className="af-pg-stat-label">{item.label}</span>
          const valueEl = <span className="af-pg-stat-value af-num">{item.missing ? '—' : item.value}</span>
          const value =
            item.movement && !item.missing ? (
              <span className="af-pg-stat-valuerow">
                {valueEl}
                <span className="af-pg-stat-move af-num" data-dir={item.movement.direction}>
                  <span aria-hidden="true">
                    {ARROW[item.movement.direction]}
                    {item.movement.amount}
                  </span>
                  <span className="af-pg-stat-sr">{item.movement.label}</span>
                </span>
              </span>
            ) : (
              valueEl
            )
          return (
            <div
              key={item.key}
              className={['af-pg-stat', item.className].filter(Boolean).join(' ')}
              data-tone={item.missing ? undefined : item.tone}
              data-missing={item.missing ? 'true' : undefined}
              data-testid={item.testId}
              {...dataAttrs(item.data)}
            >
              {order === 'value-first' ? (
                <>
                  {value}
                  {label}
                </>
              ) : (
                <>
                  {label}
                  {value}
                </>
              )}
              {item.sub != null && item.sub !== '' ? <span className="af-pg-stat-sub">{item.sub}</span> : null}
              {item.reason != null && item.reason !== '' ? <span className="af-pg-stat-why">{item.reason}</span> : null}
              {item.extra ?? null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
