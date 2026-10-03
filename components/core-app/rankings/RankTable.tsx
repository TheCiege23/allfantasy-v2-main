'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

/**
 * RankTable — the one table every Rankings view renders.
 *
 * ⚠ A REAL `<table>`, VIRTUALISED WITH SPACER ROWS. Windowing usually means
 * absolutely-positioned divs, which throws away everything a screen reader knows
 * about a table: column headers, row headers, "row 40 of 540". Here the rows stay
 * `<tr>`s inside one `<tbody>`, and the skipped height above and below the window
 * is two empty spacer rows. `aria-rowcount` / `aria-rowindex` carry the true
 * size, so a reader announces the full table while the DOM holds a slice of it.
 *
 * ⚠ SORTING IS A LINK, NOT A CLICK HANDLER. Each sortable header is an `<a>` to
 * the same page with `?sort=`, so it works with a keyboard, without JavaScript,
 * survives a reload and can be shared. `aria-sort` sits on the `<th>`, where the
 * ARIA spec puts it.
 *
 * ⚠ SHORT TABLES ARE NOT VIRTUALISED. Below `virtualizeAt` rows every row is in
 * the server HTML, so the common case needs no JavaScript at all. Above it the
 * server renders the first window and a `<noscript>` line says how to narrow the
 * list instead.
 *
 * Guidance followed: https://web.dev/articles/virtualize-long-lists-react-window
 */

export type RankColumn = {
  key: string
  label: string
  /** Replaces `label` for assistive tech when the visible label is terse. */
  srLabel?: string
  align?: 'left' | 'right' | 'center'
  /** Present when the column can be sorted; the link to the page sorted by it. */
  sortHref?: string
  sort?: 'ascending' | 'descending' | 'none'
  /** Hidden below 720px; the value moves into the row's "More" toggle (`PhoneMore`). */
  hideOnPhone?: boolean
}

export type RankCell = {
  text: string
  href?: string
  title?: string
  tone?: 'good' | 'bad' | 'warn' | 'accent' | 'muted'
  sub?: string
}

export type RankRow = {
  id: string
  highlight?: boolean
  cells: RankCell[]
}

export const VIRTUALIZE_AT = 60
const ROW_HEIGHT = 48
const VIEW_HEIGHT = 560

export function RankTable({
  caption,
  columns,
  rows,
  rowHeaderIndex = 1,
  emptyText,
  virtualizeAt = VIRTUALIZE_AT,
  phoneSort = true,
}: {
  caption: string
  columns: RankColumn[]
  rows: RankRow[]
  /** Which cell names the row — read out before every other cell. */
  rowHeaderIndex?: number
  emptyText: string
  virtualizeAt?: number
  /**
   * Render the phone sort chips above the table. A screen that folds its board controls
   * (PhoneFold) passes false and renders <PhoneSort> inside the fold, so the chips appear once.
   */
  phoneSort?: boolean
}) {
  if (rows.length === 0) return <p className="af-rk-empty">{emptyText}</p>
  const virtual = rows.length > virtualizeAt
  return virtual ? (
    <VirtualTable caption={caption} columns={columns} rows={rows} rowHeaderIndex={rowHeaderIndex} phoneSort={phoneSort} />
  ) : (
    <>
    {phoneSort ? <PhoneSort columns={columns} /> : null}
    <div className="af-rk-tablewrap" role="region" aria-label={caption} tabIndex={0}>
      <table className="af-rk-grid-table af-rk-cards" aria-rowcount={rows.length + 1}>
        <Caption caption={caption} count={rows.length} />
        <Head columns={columns} />
        <tbody>
          {rows.map((row, i) => (
            <Row key={row.id} row={row} columns={columns} index={i} rowHeaderIndex={rowHeaderIndex} />
          ))}
        </tbody>
      </table>
    </div>
    </>
  )
}

function VirtualTable({
  caption,
  columns,
  rows,
  rowHeaderIndex,
  phoneSort,
}: {
  caption: string
  columns: RankColumn[]
  rows: RankRow[]
  rowHeaderIndex: number
  phoneSort: boolean
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    // Same first window on the server and on the first client render, so hydration matches.
    initialRect: { width: 0, height: VIEW_HEIGHT },
  })
  const items = virtualizer.getVirtualItems()
  const total = virtualizer.getTotalSize()
  const top = items.length ? items[0].start : 0
  const bottom = items.length ? total - items[items.length - 1].end : 0

  return (
    <>
      {phoneSort ? <PhoneSort columns={columns} /> : null}
      <div
        ref={scrollRef}
        className="af-rk-tablewrap af-rk-tablewrap--virtual"
        role="region"
        aria-label={`${caption} — scroll to see all ${rows.length} rows`}
        tabIndex={0}
        style={{ maxHeight: VIEW_HEIGHT }}
      >
        <table className="af-rk-grid-table af-rk-cards" aria-rowcount={rows.length + 1}>
          <Caption caption={caption} count={rows.length} />
          <Head columns={columns} sticky />
          <tbody>
            {top > 0 ? (
              <tr aria-hidden="true" className="af-rk-vspacer">
                <td colSpan={columns.length} style={{ height: top }} />
              </tr>
            ) : null}
            {items.map((item) => (
              <Row
                key={rows[item.index].id}
                row={rows[item.index]}
                columns={columns}
                index={item.index}
                rowHeaderIndex={rowHeaderIndex}
                height={ROW_HEIGHT}
                measureRef={virtualizer.measureElement}
              />
            ))}
            {bottom > 0 ? (
              <tr aria-hidden="true" className="af-rk-vspacer">
                <td colSpan={columns.length} style={{ height: bottom }} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <noscript>
        <p className="af-rk-note">
          Showing the first {items.length} of {rows.length} rows. Use the filters above to narrow the list.
        </p>
      </noscript>
    </>
  )
}

/**
 * Phone only (≤720px, CSS). A row becomes a card there and the header row is
 * hidden, so the sortable columns are offered as a row of chips instead — the
 * same links the header carries, nothing new to keep in step.
 */
export function PhoneSort({ columns }: { columns: RankColumn[] }) {
  const sortable = columns.filter((c) => c.sortHref)
  if (sortable.length === 0) return null
  return (
    <nav className="af-rk-phonesort" aria-label="Sort">
      <span className="af-rk-phonesort-label" aria-hidden="true">
        Sort
      </span>
      {sortable.map((c) => (
        <Link
          key={c.key}
          href={c.sortHref!}
          scroll={false}
          className="af-rk-tab"
          aria-current={c.sort && c.sort !== 'none' ? 'true' : undefined}
        >
          {c.label === '#' ? 'Rank' : c.label}
          {c.sort === 'ascending' ? ' ▲' : c.sort === 'descending' ? ' ▼' : ''}
        </Link>
      ))}
    </nav>
  )
}

function Caption({ caption, count }: { caption: string; count: number }) {
  return (
    <caption className="af-rk-caption">
      {caption}
      <span className="af-rk-sr"> — {count} {count === 1 ? 'row' : 'rows'}</span>
    </caption>
  )
}

function Head({ columns, sticky = false }: { columns: RankColumn[]; sticky?: boolean }) {
  return (
    <thead className={sticky ? 'af-rk-sticky' : undefined}>
      <tr aria-rowindex={1}>
        {columns.map((c) => (
          <th
            key={c.key}
            scope="col"
            aria-sort={c.sortHref ? (c.sort ?? 'none') : undefined}
            className={[c.align ? `af-rk-${c.align}` : '', c.hideOnPhone ? 'af-rk-hide-phone' : ''].join(' ').trim() || undefined}
          >
            {c.sortHref ? (
              <Link
                href={c.sortHref}
                scroll={false}
                className="af-rk-sortlink"
                aria-label={`${c.srLabel ?? c.label}${
                  c.sort === 'ascending' ? ', sorted ascending' : c.sort === 'descending' ? ', sorted descending' : ''
                }. Activate to sort.`}
              >
                {c.label}
                <span aria-hidden="true" className="af-rk-sorticon">
                  {c.sort === 'ascending' ? '▲' : c.sort === 'descending' ? '▼' : '↕'}
                </span>
              </Link>
            ) : c.srLabel ? (
              <>
                <span aria-hidden="true">{c.label}</span>
                <span className="af-rk-sr">{c.srLabel}</span>
              </>
            ) : (
              c.label
            )}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function Row({
  row,
  columns,
  index,
  rowHeaderIndex,
  height,
  measureRef,
}: {
  row: RankRow
  columns: RankColumn[]
  index: number
  rowHeaderIndex: number
  height?: number
  /** The virtualiser's measurer — a row with a sub-line is taller than the estimate. */
  measureRef?: (el: Element | null) => void
}) {
  return (
    <tr
      ref={measureRef}
      data-index={index}
      aria-rowindex={index + 2}
      className={row.highlight ? 'af-rk-row-you' : undefined}
      data-phonemore={hiddenOnPhone(columns) >= PHONE_MORE_MIN ? '' : undefined}
      style={height ? { height } : undefined}
    >
      {row.cells.map((cell, ci) => {
        const col = columns[ci]
        /*
         * The phone card's slot for this cell (CSS reads it at ≤720px): the first cell leads, the
         * row header is the title, the first other always-visible cell is the headline value, and
         * the other always-visible cells become labelled chips. Columns a desktop table hides on
         * phones go behind the row's "More" toggle (`PhoneMore`), so a phone still reaches every
         * number without every card carrying all of them.
         */
        const firstValue = columns.findIndex((c, i) => i !== 0 && i !== rowHeaderIndex && !c.hideOnPhone)
        const card = ci === 0 ? 'lead' : ci === rowHeaderIndex ? 'title' : ci === firstValue ? 'value' : 'detail'
        // A chip whose text already says what it is ("Why") needs no label in front of it.
        const label = col?.label === '#' ? 'Rank' : col?.label === cell.text ? '' : col?.label
        const cls =
          [col?.align ? `af-rk-${col.align}` : '', col?.hideOnPhone ? 'af-rk-hide-phone' : '', cell.tone ? `af-rk-tone-${cell.tone}` : '']
            .join(' ')
            .trim() || undefined
        const body = (
          <>
            {cell.href ? (
              <Link href={cell.href} scroll={false} className="af-rk-celllink">
                {cell.text}
              </Link>
            ) : (
              cell.text
            )}
            {cell.sub ? <span className="af-rk-cellsub">{cell.sub}</span> : null}
          </>
        )
        return ci === rowHeaderIndex ? (
          <th key={col?.key ?? ci} scope="row" className={cls} title={cell.title} data-card={card} data-label={label}>
            {body}
          </th>
        ) : (
          <td key={col?.key ?? ci} className={cls} title={cell.title} data-card={card} data-label={label}>
            {body}
          </td>
        )
      })}
      <PhoneMore row={row} columns={columns} />
    </tr>
  )
}

/**
 * Phone only (≤720px, CSS). The columns a desktop table hides on phones used to become chips on
 * every card, which made a row ~160px tall at 375px — four rows to a screen. They now sit behind a
 * per-row "More" toggle instead, so a phone still reaches every number with one tap.
 *
 * ⚠ AN EXTRA CELL WITH NO HEADER. Above 720px it is `display: none`, which removes it from the
 * accessibility tree too, so a desktop reader never meets a cell its column headers do not name.
 * At ≤720px the original cells are the hidden ones, so each value is announced exactly once.
 */
const PHONE_MORE_MIN = 2

function hiddenOnPhone(columns: RankColumn[]): number {
  return columns.filter((c) => c.hideOnPhone).length
}

function PhoneMore({ row, columns }: { row: RankRow; columns: RankColumn[] }) {
  /*
   * ⚠ ONE HIDDEN COLUMN STAYS A CHIP. Measured at 375px: a toggle for a single value made the
   * league table's rows taller (65px → 80px), not shorter. The row's `data-phonemore` is what
   * tells the CSS to hide the originals, so below the threshold nothing changes at all.
   */
  if (hiddenOnPhone(columns) < PHONE_MORE_MIN) return null
  const hidden = columns.flatMap((c, i) => (c.hideOnPhone && row.cells[i] ? [{ col: c, cell: row.cells[i] }] : []))
  if (hidden.length === 0) return null
  return (
    <td className="af-rk-phonemore" data-card="more">
      <details>
        <summary>More</summary>
        <dl className="af-rk-phonemore-list">
          {hidden.map(({ col, cell }) => (
            <div key={col.key}>
              <dt>{col.srLabel ?? col.label}</dt>
              <dd className={cell.tone ? `af-rk-tone-${cell.tone}` : undefined}>
                {cell.href ? (
                  <Link href={cell.href} scroll={false} className="af-rk-celllink">
                    {cell.text}
                  </Link>
                ) : (
                  cell.text
                )}
                {cell.sub ? <span className="af-rk-cellsub">{cell.sub}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </td>
  )
}

export default RankTable
