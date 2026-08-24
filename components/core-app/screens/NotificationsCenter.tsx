'use client'

import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import type {
  NotificationFilter,
  NotificationRow,
  NotificationsCenterData,
} from '@/lib/core-app/notificationsCenter'
import '@/components/core-app/af-notifications.css'

/**
 * 22c — the in-app notifications centre.
 *
 * ⚠ FILTER COUNTS ARE LIVE, NOT LITERALS. They come off the loader's `counts`,
 * which is derived from the rows in view. The handoff's own numbers (Trades 6,
 * Waivers 6 …) are that account's, and hardcoding them is how a filter ends up
 * promising six trades and showing none.
 *
 * ⚠ "ACT TODAY" IS THE SAME URGENCY AS EVERYWHERE ELSE. It is built upstream
 * from `deriveOutstandingIssues` — the engine behind the home queue and the
 * Tools hub — so a lineup that is urgent here is urgent there too.
 *
 * ⚠ ACTION LABELS ARE VERBS. Fix, Queue, Review, Reply — decided once, in
 * `verbFor` in the loader. If a generic "Open" ever appears on this screen, the
 * fix is in that function, not here.
 *
 * The lock-screen preview is rendered by `LockScreenPreview` in the dev handoff
 * preview rather than in the product — it is a mock of the phone, not a surface
 * a signed-in user needs. The selection logic behind it, however, is real and
 * shared: `selectPushNotifications`.
 */

export type NotificationsCenterProps = {
  data: NotificationsCenterData
}

const FILTERS: Array<{ id: NotificationFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'trades', label: 'Trades' },
  { id: 'waivers', label: 'Waivers' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'lineups', label: 'Lineups' },
  { id: 'drafts', label: 'Drafts' },
]

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function Row({
  row,
  urgent,
  onRead,
}: {
  row: NotificationRow
  urgent?: boolean
  onRead?: (id: string) => void
}) {
  return (
    <li className="af-nt-row" data-severity={row.severity} data-read={row.read} data-urgent={!!urgent}>
      <span className="af-nt-dot" aria-hidden />
      <span className="af-nt-body">
        <span className="af-nt-toprow">
          <b className="af-nt-title">{row.title}</b>
          {row.leagueName ? (
            <span className="af-nt-league af-platform" data-platform={row.platform ?? undefined}>
              {row.leagueName}
            </span>
          ) : null}
        </span>
        {/* The specific reason. Never "you have an update". */}
        <span className="af-nt-detail">{row.detail}</span>
        {!urgent ? <span className="af-nt-time af-num">{timeAgo(row.createdAt)}</span> : null}
      </span>

      {row.action ? (
        row.action.external ? (
          <a
            className="af-nt-act"
            href={row.action.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onRead?.(row.id)}
          >
            {row.action.label}
          </a>
        ) : (
          <Link className="af-nt-act" href={row.action.href} onClick={() => onRead?.(row.id)}>
            {row.action.label}
          </Link>
        )
      ) : null}
    </li>
  )
}

export function NotificationsCenter({ data }: NotificationsCenterProps) {
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [marking, setMarking] = useState(false)

  const match = useCallback(
    (r: NotificationRow) => filter === 'all' || r.kind === filter,
    [filter],
  )

  const actToday = useMemo(() => data.actToday.filter(match), [data.actToday, match])
  const rest = useMemo(
    () =>
      data.rest
        .filter(match)
        .map((r) => (readIds.has(r.id) ? { ...r, read: true } : r)),
    [data.rest, match, readIds],
  )

  /*
   * Marking read hits the existing PATCH on /api/user/notifications — no new
   * route. The repo sits at Vercel's hard 2048-route ceiling and a read-receipt
   * is not worth one; that endpoint already accepts `{ ids: [...] }` or
   * `{ ids: "all" }`.
   *
   * Derived "act today" rows carry an `issue:` id and have no database row, so
   * they are filtered out of the request rather than sent and silently ignored.
   */
  const markRead = useCallback(async (ids: string[] | 'all') => {
    const payload =
      ids === 'all' ? 'all' : ids.filter((id) => !id.startsWith('issue:'))
    if (payload !== 'all' && payload.length === 0) return
    setMarking(true)
    await fetch('/api/user/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: payload }),
    }).catch(() => null)
    setReadIds((prev) => {
      const next = new Set(prev)
      if (payload === 'all') for (const r of data.rest) next.add(r.id)
      else for (const id of payload) next.add(id)
      return next
    })
    setMarking(false)
  }, [data.rest])

  const unread = rest.filter((r) => !r.read).length + actToday.length

  return (
    <div className="af-nt">
      <header className="af-nt-head">
        <div>
          <h1 className="af-display af-nt-title">Notifications</h1>
          <p className="af-nt-sub">
            {unread > 0
              ? `${unread} waiting. The ones with a clock on them are at the top.`
              : 'Nothing is waiting on you.'}
          </p>
        </div>
        <button
          type="button"
          className="af-nt-markall"
          onClick={() => markRead('all')}
          disabled={marking || data.rest.every((r) => r.read || readIds.has(r.id))}
        >
          {marking ? 'Marking…' : 'Mark all read'}
        </button>
      </header>

      {/* Live counts, straight off the loader. */}
      <div className="af-nt-filters" role="tablist" aria-label="Filter notifications">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className="af-nt-filter"
            data-on={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <span className="af-nt-filtercount af-num">{data.counts[f.id]}</span>
          </button>
        ))}
      </div>

      {actToday.length > 0 ? (
        <section className="af-nt-section" data-tier="urgent">
          <h2 className="af-nt-sectiontitle">Act today</h2>
          <p className="af-nt-sectionnote">
            Every one of these has a deadline before tomorrow. Nothing without a clock is in here.
          </p>
          <ul className="af-nt-list">
            {actToday.map((r) => (
              <Row key={r.id} row={r} urgent />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="af-nt-section">
        <h2 className="af-nt-sectiontitle">Everything else</h2>
        {rest.length > 0 ? (
          <ul className="af-nt-list">
            {rest.map((r) => (
              <Row key={r.id} row={r} onRead={(id) => markRead([id])} />
            ))}
          </ul>
        ) : (
          <p className="af-nt-empty">
            {filter === 'all'
              ? 'No notifications on file. This is a log of things that happened — an empty one means nothing has, not that we stopped watching.'
              : `Nothing under ${FILTERS.find((f) => f.id === filter)!.label}.`}
          </p>
        )}
      </section>

      {/*
        The suppression rule, stated to the user. It is the design principle of
        the whole surface, so it is copy rather than a footnote.
      */}
      {data.push.suppressedReason ? (
        <footer className="af-nt-foot">
          <p className="af-nt-foot-t">Why your phone stayed quiet</p>
          <p className="af-nt-foot-b">{data.push.suppressedReason}</p>
          <p className="af-nt-foot-b">
            At this many leagues the job is holding things back, not sending them. Anything without
            a deadline waits here instead of ringing.
          </p>
          <Link href="/settings?tab=notifications" className="af-nt-foot-link">
            Change what gets through
          </Link>
        </footer>
      ) : null}
    </div>
  )
}

export default NotificationsCenter
