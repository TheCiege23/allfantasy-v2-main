/**
 * How long until a lineup locks, in words a reader can act on.
 *
 * ⚠ IT USED TO PRINT "2321:15:08" ON THE PER-LEAGUE SCREEN. Hours were the
 * largest unit, so a lock 97 days out rendered as a four-digit hour count that
 * read like a stopwatch — see the note on `LockCountdown` in `MyTeam.tsx`. Days
 * lead when there are days, and past a fortnight the number stops being a
 * deadline at all and says the date instead.
 *
 * Pure and framework-free on purpose: the board renders this on the SERVER for
 * the first paint and the clock re-renders it on the CLIENT every half minute.
 * Two implementations would drift, and the drift would show up as a value that
 * visibly changes on hydration.
 */

/** Past this, a countdown is not a deadline any more. */
const DISTANT_DAYS = 14

export type LockLabel = {
  /** "3d 4h", "02:14:39", "Locked", or a plain date when it is far out. */
  text: string
  locked: boolean
  /** Under an hour, or already gone. The row tints on this. */
  urgent: boolean
}

export function formatLockLabel(atMs: number, nowMs: number): LockLabel {
  const ms = atMs - nowMs
  if (ms <= 0) return { text: 'Locked', locked: true, urgent: true }

  const total = Math.floor(ms / 1000)
  const d = Math.floor(total / 86_400)
  const h = Math.floor((total % 86_400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  if (d >= DISTANT_DAYS) {
    /*
     * ⚠ FORMATTED IN UTC, NOT IN THE SERVER'S ZONE. This string is rendered on
     * the server for the first paint and re-rendered in the browser by the
     * clock; `toLocaleDateString` with no zone would resolve to two different
     * zones and the date would change on hydration.
     */
    const at = new Date(atMs)
    const day = at.toUTCString().slice(5, 11).trim()
    return { text: day, locked: false, urgent: false }
  }

  const text =
    d > 0
      ? `${d}d ${h}h`
      : `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`

  return { text, locked: false, urgent: ms <= 3_600_000 }
}
