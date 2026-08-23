'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The live resend countdown shared by the password-reset "sent" card (handoff
 * 16a state 2) and the verify-email "pending" / "rate limited" cards (16b states
 * 1 and 3). 16b's build note asks for exactly one component behind both, which is
 * why this is a hook rather than a timer inside either screen.
 *
 * ⚠ THE DEADLINE IS AN ABSOLUTE TIMESTAMP, NOT A DECREMENTING COUNTER. A counter
 * driven by setInterval loses time whenever the tab is backgrounded — browsers
 * clamp background intervals to roughly once a second at best and stop them
 * entirely on mobile — so a user who switches to their mail app (which is the
 * single most likely thing for them to do on this screen) and comes back would
 * find the button still locked long after the real cooldown had passed. Storing
 * the deadline and re-deriving the remainder on every tick means a backgrounded
 * tab simply catches up.
 *
 * ⚠ THE SERVER REMAINS THE AUTHORITY. This is presentation only: /api/auth/
 * verify-email/send enforces 3 sends per 120s plus a 60s spacing rule of its own,
 * and the reset request route its own limiter. A cleared countdown here means
 * "you may try", never "the server will accept" — the screens still handle a 429
 * coming back.
 */
export type ResendCooldown = {
  /** Whole seconds left, 0 when clear. */
  secondsLeft: number
  /** True while the countdown is running. */
  active: boolean
  /** "0:47" — the format the handoff prints inside the button. */
  label: string
  /** Start (or restart) the countdown. */
  start: (seconds: number) => void
  /** Clear it immediately — used when a send fails and re-arming would be a lie. */
  reset: () => void
}

export function formatCooldown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function useResendCooldown(initialSeconds = 0): ResendCooldown {
  const deadlineRef = useRef<number | null>(
    initialSeconds > 0 ? Date.now() + initialSeconds * 1000 : null,
  )
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.ceil(initialSeconds)))

  useEffect(() => {
    if (secondsLeft <= 0) return

    const tick = () => {
      const deadline = deadlineRef.current
      if (deadline == null) {
        setSecondsLeft(0)
        return
      }
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSecondsLeft(remaining)
      if (remaining === 0) deadlineRef.current = null
    }

    const id = window.setInterval(tick, 1000)
    // A visible tab that was backgrounded across several ticks should snap to the
    // truth the moment it comes back rather than waiting up to a second for the
    // next interval.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [secondsLeft])

  const start = useCallback((seconds: number) => {
    const safe = Math.max(0, Math.floor(seconds))
    deadlineRef.current = safe > 0 ? Date.now() + safe * 1000 : null
    setSecondsLeft(safe)
  }, [])

  const reset = useCallback(() => {
    deadlineRef.current = null
    setSecondsLeft(0)
  }, [])

  return {
    secondsLeft,
    active: secondsLeft > 0,
    label: formatCooldown(secondsLeft),
    start,
    reset,
  }
}

export default useResendCooldown
