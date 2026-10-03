'use client'

import { useEffect, useState } from 'react'

import { countdownText, nextWaiverRunMs, type WaiverSchedule } from '@/lib/core-app/waiverRunClock'

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * A league's next waiver run in the VIEWER's timezone, with a countdown.
 *
 * ⚠ THE FIRST RENDER IS THE UTC LABEL, BY DESIGN. The server has no idea what timezone the reader
 * is in, and rendering a local time there would hydrate as the server's zone and then jump. So the
 * server and the first client paint agree on "Wednesday 09:00 UTC", and the local time and the
 * countdown replace it once mounted. A reader with scripts off still gets a true statement.
 */
export function WaiverRunClock({
  schedule,
  compact = false,
  yourTime = ' your time',
  localOnly = false,
}: {
  schedule: WaiverSchedule
  /** One short line ("Wed 5:00 AM · in 14h 05m") for a card; the full form for the rules list. */
  compact?: boolean
  /** The full form's suffix, so a translated screen can say it in its own language. */
  yourTime?: string
  /** Render nothing until mounted — for a spot that already prints the UTC label beside it. */
  localOnly?: boolean
}) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const utcLabel = `${DAY[schedule.dayOfWeek] ?? 'Unknown day'} ${schedule.timeUtc} UTC`
  const next = now != null ? nextWaiverRunMs(schedule, now) : null
  if (now == null || next == null) {
    return localOnly ? null : <span data-testid="waiver-run-clock">{utcLabel}</span>
  }

  const local = new Intl.DateTimeFormat(undefined, {
    weekday: compact ? 'short' : 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(next))
  const soon = next - now <= 24 * 3_600_000
  return (
    <span data-testid="waiver-run-clock" data-soon={soon ? 'true' : undefined} title={utcLabel}>
      {local}
      {compact ? '' : yourTime}
      <span className="af-wv-clock-in"> · {countdownText(next - now)}</span>
    </span>
  )
}

export default WaiverRunClock
