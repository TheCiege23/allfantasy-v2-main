'use client'

import { useEffect, useState } from 'react'

/**
 * The seconds left on a live draft pick.
 *
 * ⚠ THE FIRST RENDER MUST MATCH THE SERVER'S, or React reports a hydration
 * mismatch and the number visibly jumps. Same rule and same shape as
 * `MyTeamLockClock`: the server-computed label renders until `useEffect` runs,
 * and only then does the clock start.
 *
 * ⚠ AND IT STOPS AT ZERO RATHER THAN GOING NEGATIVE. A pick timer that has
 * expired means the draft is mid-autopick or paused, not that the manager is
 * "−0:12" late, and a negative countdown on a draft board reads as a bug.
 */

function label(msLeft: number): string {
  if (msLeft <= 0) return 'TIME'
  const total = Math.floor(msLeft / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function DraftClock({ endsAt }: { endsAt: string }) {
  const atMs = Date.parse(endsAt)
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    const at = now ?? Date.now()
    if (now == null) {
      setNow(at)
      return
    }
    if (at >= atMs) return
    const id = setTimeout(() => setNow(Date.now()), 1000)
    return () => clearTimeout(id)
  }, [now, atMs])

  if (!Number.isFinite(atMs)) return null

  /*
   * Before hydration `now` is null, and the server has no wall clock it can
   * agree with the client on — so the first paint is the deadline itself
   * rendered as a full minute count, not a number that will disagree.
   */
  const msLeft = now == null ? atMs - Date.parse(endsAt) : atMs - now

  return (
    <span
      className="af-bd-stat af-bd-stat--narrow"
      data-sev={msLeft <= 30_000 ? 'bad' : 'warn'}
      suppressHydrationWarning
    >
      {now == null ? '—' : label(msLeft)}
    </span>
  )
}

export default DraftClock
