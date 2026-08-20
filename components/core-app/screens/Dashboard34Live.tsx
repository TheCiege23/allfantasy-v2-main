'use client'

import { useEffect, useState } from 'react'

/**
 * The two pieces of Dashboard 34a that cannot be rendered on the server.
 *
 * ⚠ BOTH START AS THE SERVER'S STRING AND ONLY THEN CORRECT THEMSELVES. Rendering
 * either value during the first client pass would be a hydration mismatch — the
 * server's clock and the reader's are never the same millisecond, and the reader's
 * time zone is not knowable on the server at all. So first paint is byte-identical
 * to the server's, and `useEffect` (which runs after hydration) takes over.
 *
 * ⚠ THE COUNTDOWN IS ALSO WHY THE PAGE IS `force-dynamic`. A cached home would
 * serve a countdown frozen at build time, which is worse than no countdown: it
 * looks live and is wrong. The CSS gives these cells tabular figures and a fixed
 * width so a tick never reflows the row — the handoff's CLS budget is 0.02.
 */

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Must produce the same shape as `formatCountdown` in lib/core-app/dash34.ts. */
function format(ms: number): string {
  if (ms <= 0) return '0:00:00'
  const total = Math.floor(ms / 1000)
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (days > 0) return `${days}d ${pad(hours)}:${pad(mins)}`
  return `${hours}:${pad(mins)}:${pad(secs)}`
}

export function Dash34Countdown({ to, initial }: { to: string; initial: string }) {
  const [label, setLabel] = useState(initial)

  useEffect(() => {
    const target = new Date(to).getTime()
    if (!Number.isFinite(target)) return
    const tick = () => setLabel(format(target - Date.now()))
    tick()
    // One second, because the display has a seconds field below 24h. Above that
    // it only shows minutes, but the interval is cheap and the branch is not
    // worth the extra state.
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [to])

  return <>{label}</>
}

/**
 * A UTC timestamp shown in the reader's own zone.
 *
 * The server has no way to know that zone, so it renders UTC and this swaps in
 * the local rendering after hydration. A kickoff time in the wrong zone is not a
 * cosmetic problem — it is the one number on the row someone might set an alarm by.
 */
export function Dash34Time({ iso }: { iso: string }) {
  // UTC is derived rather than passed, because it is the one rendering both the
  // server and the first client pass agree on — `Date.now()` is not, which is why
  // the countdown above has to be handed its starting string instead.
  const utc = utcLabel(iso)
  const [label, setLabel] = useState(utc)

  useEffect(() => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return
    setLabel(d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))
  }, [iso])

  return <>{label}</>
}

function utcLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

/**
 * How old a fact is — "30 min ago".
 *
 * ⚠ SAME TWO-PASS CONTRACT AS THE COUNTDOWN, AND FOR THE SAME REASON. Elapsed
 * time is derived from `Date.now()`, which the server and the reader never agree
 * on, so the first client paint MUST be the string the server sent. `initial` is
 * that string; `useEffect` runs after hydration and re-derives from `iso`.
 * Computing it during render instead is a hydration mismatch on a page that has
 * already been taken down once by one.
 *
 * ⚠ `format` BELOW MIRRORS `formatAgo` IN lib/core-app/dash34.ts. If the two
 * drift, the value visibly changes shape the instant the page hydrates.
 */
export function Dash34Ago({ iso, initial }: { iso: string; initial: string }) {
  const [label, setLabel] = useState(initial)

  useEffect(() => {
    const at = new Date(iso).getTime()
    if (!Number.isFinite(at)) return
    const tick = () => setLabel(formatAgo(Date.now() - at))
    tick()
    // A minute, not a second: the coarsest unit this renders is minutes, so a
    // faster interval would re-render the row without ever changing a character.
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [iso])

  return <>{label}</>
}

/** Must produce the same shape as `formatAgo` in lib/core-app/dash34.ts. */
function formatAgo(ms: number): string {
  if (ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/**
 * A day AND a time — "Thu 8:20 PM" — for an instant that may not be today.
 *
 * `Dash34Time` above renders the clock only, which is right for a row already
 * scoped to the next 24 hours. A player's next kickoff can be six days out, and
 * "8:20 PM" with no day attached reads as tonight.
 *
 * Same two-pass rule: UTC on the server and on the first client paint, local
 * afterwards.
 */
export function Dash34When({ iso }: { iso: string }) {
  const utc = utcDayLabel(iso)
  const [label, setLabel] = useState(utc)

  useEffect(() => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return
    setLabel(
      d.toLocaleString(undefined, {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }),
    )
  }, [iso])

  return <>{label}</>
}

const UTC_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function utcDayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${UTC_DAYS[d.getUTCDay()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}
