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
