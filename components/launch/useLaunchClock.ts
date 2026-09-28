'use client'

import { useEffect, useState } from 'react'
import { splitRemaining, type CountdownParts } from '@/components/launch/launchTime'

/**
 * The launch clock, hydration-safe.
 *
 *   static  — the server render and the browser's FIRST render. No clock is read, so both print
 *             the same markup and hydration cannot mismatch on a second that ticked in between.
 *   live    — after mount, recomputed from `Date.now()` every second (never by decrementing, so a
 *             throttled background tab is right the moment it is looked at again).
 *   ended   — the moment has passed, or `startsAt` is not a date. The interval stops.
 */
export type LaunchClock =
  | { phase: 'static' }
  | { phase: 'live'; parts: CountdownParts }
  | { phase: 'ended' }

export function useLaunchClock(startsAtIso: string): LaunchClock {
  const target = Date.parse(startsAtIso)
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    if (!Number.isFinite(target)) return
    let id: number | undefined
    const stop = () => {
      if (id !== undefined) window.clearInterval(id)
      id = undefined
    }
    const tick = () => {
      const t = Date.now()
      setNow(t)
      if (t >= target) stop()
    }
    tick()
    if (Date.now() < target) id = window.setInterval(tick, 1000)
    return stop
  }, [target])

  if (!Number.isFinite(target)) return { phase: 'ended' }
  if (now === null) return { phase: 'static' }
  const parts = splitRemaining(target - now)
  return parts ? { phase: 'live', parts } : { phase: 'ended' }
}
