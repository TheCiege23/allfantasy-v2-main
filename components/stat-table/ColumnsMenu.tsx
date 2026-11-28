'use client'

import { useId, useState } from 'react'
import { applyLayout, isDefaultLayout, moveColumn, toggleColumn, type TableLayout } from '@/lib/table-layout/statTableLayout'
import { useStatTableLayouts } from './useStatTableLayouts'
import './stat-table.css'

/**
 * "Columns" for a stat table: show or hide each column, move it left or right, reset to the
 * default, and switch every stat table between comfortable and compact. Saved per table id
 * (lib/table-layout), so a hockey skater log and a goalie log keep layouts of their own.
 *
 * Up/down buttons rather than drag: they work the same with a thumb, a mouse, a keyboard and a
 * screen reader, which a drag handle in a scrolling table does not.
 */

export function ColumnsMenu({
  tableId,
  columns,
}: {
  tableId: string
  /** The table's own columns, in their default order. */
  columns: ReadonlyArray<{ key: string; label: string; title?: string }>
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const { layoutFor, setLayout, density, setDensity } = useStatTableLayouts()
  const saved = layoutFor(tableId)
  const layout: TableLayout = saved ?? { order: [], hidden: [] }
  const ordered = applyLayout(columns, { order: layout.order, hidden: [] })
  const hidden = new Set(layout.hidden)
  const shownCount = ordered.filter((c) => !hidden.has(c.key)).length

  return (
    <div className="af-cols">
      <button
        type="button"
        className="af-cols-btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((x) => !x)}
        data-testid="columns-menu-toggle"
      >
        Columns{isDefaultLayout(saved) ? '' : ' •'}
      </button>
      {open ? (
        <div id={panelId} className="af-cols-panel" role="group" aria-label="Choose columns" data-testid="columns-menu">
          <ol className="af-cols-list">
            {ordered.map((c, i) => {
              const isHidden = hidden.has(c.key)
              const name = c.title ?? c.label
              return (
                <li key={c.key} className="af-cols-item" data-hidden={isHidden || undefined}>
                  <label className="af-cols-check">
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      // The last visible column cannot be hidden: a table with no columns is not a table.
                      disabled={!isHidden && shownCount <= 1}
                      onChange={() => setLayout(tableId, toggleColumn(layout, c.key))}
                    />
                    <span>
                      <b>{c.label}</b>
                      {c.title && c.title !== c.label ? <small> {c.title}</small> : null}
                    </span>
                  </label>
                  <span className="af-cols-move">
                    <button type="button" aria-label={`Move ${name} earlier`} disabled={i === 0} onClick={() => setLayout(tableId, moveColumn(columns, layout, c.key, -1))}>
                      ▲
                    </button>
                    <button type="button" aria-label={`Move ${name} later`} disabled={i === ordered.length - 1} onClick={() => setLayout(tableId, moveColumn(columns, layout, c.key, 1))}>
                      ▼
                    </button>
                  </span>
                </li>
              )
            })}
          </ol>
          <div className="af-cols-foot">
            <label className="af-cols-check">
              <input
                type="checkbox"
                checked={density === 'compact'}
                onChange={(e) => setDensity(e.target.checked ? 'compact' : 'comfortable')}
                data-testid="columns-menu-compact"
              />
              <span>Compact tables</span>
            </label>
            <button type="button" className="af-cols-reset" disabled={isDefaultLayout(saved)} onClick={() => setLayout(tableId, null)}>
              Reset columns
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
