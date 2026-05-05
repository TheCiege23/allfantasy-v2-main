'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { computeDraftCountdownSeconds } from '@/lib/draft/computeDraftCountdownSeconds'

export type DraftCountdownPauseReason = 'commissioner' | 'overnight_window' | null | undefined

export type UseDraftCountdownOpts = {
  pauseReason?: DraftCountdownPauseReason
  overnightResumeAtIso?: string | null
}

/**
 * Client-side display tick for draft timers. **Never** decrement a stored second count.
 * Remaining is always recomputed as `max(0, ceil((timerEndAt - now) / 1000))` when `timerEndAtIso`
 * is set; `tick` only forces a re-render on an interval so `Date.now()` updates.
 *
 * When the server snapshot has no `timerEndAt` but exposes `remainingSeconds`, anchor a soft local
 * end time so the UI still ticks between polls (re-syncs whenever `serverRemainingSeconds` changes).
 *
 * Single interval per hook instance: cleans up on unmount and when timer inputs change.
 */
export function useDraftCountdownSeconds(
  timerStatus: 'running' | 'paused' | 'expired' | 'none',
  timerEndAtIso: string | null | undefined,
  serverRemainingSeconds: number | null | undefined,
  opts?: UseDraftCountdownOpts,
): number | null {
  const [tick, setTick] = useState(0)
  const softDeadlineMs = useRef<number | null>(null)
  const pauseReason = opts?.pauseReason
  const overnightResumeAtIso = opts?.overnightResumeAtIso

  useEffect(() => {
    softDeadlineMs.current = null
  }, [timerStatus, timerEndAtIso, serverRemainingSeconds, pauseReason, overnightResumeAtIso])

  useEffect(() => {
    const runningWithEnd = timerStatus === 'running' && Boolean(timerEndAtIso)
    const runningSoft =
      timerStatus === 'running' &&
      !timerEndAtIso &&
      serverRemainingSeconds != null &&
      Number.isFinite(serverRemainingSeconds) &&
      serverRemainingSeconds > 0
    const overnightTick =
      timerStatus === 'paused' && pauseReason === 'overnight_window' && Boolean(overnightResumeAtIso)

    if (!runningWithEnd && !runningSoft && !overnightTick) {
      return
    }

    if (runningSoft) {
      const sec = serverRemainingSeconds!
      softDeadlineMs.current = Date.now() + Math.ceil(sec) * 1000
    }

    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [timerStatus, timerEndAtIso, serverRemainingSeconds, pauseReason, overnightResumeAtIso])

  return useMemo(() => {
    void tick
    return computeDraftCountdownSeconds(
      timerStatus,
      timerEndAtIso,
      serverRemainingSeconds,
      Date.now(),
      softDeadlineMs.current,
    )
  }, [timerStatus, timerEndAtIso, serverRemainingSeconds, tick])
}
