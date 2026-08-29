'use client'

import { useEffect, useState } from 'react'

import { formatLockLabel } from '@/lib/core-app/lockLabel'

/**
 * The live half of a lineup-lock countdown.
 *
 * ⚠ THE FIRST RENDER IS THE SERVER'S STRING, NOT A FRESH ONE. `Date.now()` in a
 * component body differs between the server render and hydration, and React
 * treats that as a mismatch — the number visibly jumps and the console fills
 * with warnings. So the server passes the label it already computed, this
 * renders exactly that until `useEffect` runs, and only then starts ticking.
 *
 * A whole board of one-second timers is also not free. Under an hour the second
 * hand is the information, so it ticks; past that the minute is, and 30s is
 * enough to keep it honest at a fraction of the re-renders.
 */
export function MyTeamLockClock({
  atMs,
  initial,
}: {
  atMs: number
  /** The label the server rendered. Shown until the client clock takes over. */
  initial: string
}) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    /*
     * `now` is a dependency so the period is re-chosen as the deadline
     * approaches. Without it the interval is fixed at mount and a lock that was
     * two hours out keeps ticking every 30s through its final minute — which is
     * the one minute the second hand exists for.
     */
    const at = now ?? Date.now()
    if (now == null) setNow(at)
    const period = atMs - at <= 3_600_000 ? 1_000 : 30_000
    const id = setTimeout(() => setNow(Date.now()), period)
    return () => clearTimeout(id)
  }, [atMs, now])

  if (now == null) return <>{initial}</>
  return <>{formatLockLabel(atMs, now).text}</>
}

export default MyTeamLockClock
