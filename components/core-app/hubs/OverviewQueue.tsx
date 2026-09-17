'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { OverviewQueueRow } from '@/lib/core-app/commissionerOverview'

/**
 * "Needs a commissioner" — the all-leagues queue, ranked across leagues or grouped
 * by league. The rows are built server-side by the same `buildTaskCards` the
 * one-league screen uses; this only chooses the order.
 */

const GLYPH: Record<OverviewQueueRow['severity'], string> = { bad: '!', warn: '◆', info: '◷' }

function Row({ row, showLeague }: { row: OverviewQueueRow; showLeague: boolean }) {
  const action = row.action
  return (
    <div className="afh-row afh-queue-row" data-severity={row.severity}>
      <span className="afh-queue-mark" aria-hidden>
        {GLYPH[row.severity]}
      </span>
      <div className="afh-row-main">
        <span className="afh-row-title">
          {row.title}
          {showLeague && row.leagueName ? <span className="afh-queue-league"> — {row.leagueName}</span> : null}
        </span>
        <span className="afh-row-detail">
          {row.due ? `${row.due} · ` : ''}
          {row.detail}
        </span>
      </div>
      {action ? (
        action.external ? (
          <a className="afh-btn afh-btn--sm afh-btn--ghost" href={action.href} target="_blank" rel="noopener noreferrer">
            {action.label} ↗
          </a>
        ) : (
          <Link className="afh-btn afh-btn--sm afh-btn--ghost" href={action.href}>
            {action.label}
          </Link>
        )
      ) : null}
    </div>
  )
}

export function OverviewQueue({ rows, limit = 8 }: { rows: OverviewQueueRow[]; limit?: number }) {
  const [mode, setMode] = useState<'urgent' | 'league'>('urgent')
  const [expanded, setExpanded] = useState(false)

  const groups = useMemo(() => {
    const out = new Map<string, { name: string; rows: OverviewQueueRow[] }>()
    for (const r of rows) {
      const key = r.leagueId ?? '__all'
      const g = out.get(key) ?? { name: r.leagueName ?? 'Across your leagues', rows: [] }
      g.rows.push(r)
      out.set(key, g)
    }
    return [...out.entries()]
  }, [rows])

  const visible = expanded ? rows : rows.slice(0, limit)

  return (
    <section className="afh-panel" aria-labelledby="afh-queue">
      <div className="afh-panel-head">
        <h2 id="afh-queue" className="afh-label" style={{ margin: 0 }}>
          Needs a commissioner
        </h2>
        {rows.length > 1 ? (
          <div className="afh-seg" role="group" aria-label="Order">
            <button type="button" aria-pressed={mode === 'urgent'} onClick={() => setMode('urgent')}>
              Most urgent
            </button>
            <button type="button" aria-pressed={mode === 'league'} onClick={() => setMode('league')}>
              By league
            </button>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="afh-none">Nothing in the leagues you run needs a commissioner right now.</p>
      ) : mode === 'urgent' ? (
        <>
          {visible.map((r) => (
            <Row key={r.id} row={r} showLeague />
          ))}
          {rows.length > limit ? (
            <button type="button" className="afh-more" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          ) : null}
        </>
      ) : (
        groups.map(([key, g]) => (
          <div key={key} className="afh-queue-group">
            <div className="afh-label afh-queue-group-name">{g.name}</div>
            {g.rows.map((r) => (
              <Row key={r.id} row={r} showLeague={false} />
            ))}
          </div>
        ))
      )}
    </section>
  )
}
