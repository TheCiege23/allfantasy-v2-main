/**
 * Work on the page that a full reload would throw away and that is not typed text.
 *
 * After a deploy, NewVersionReload reloads a page the moment it goes into the background, and the
 * screen error boundary reloads onto the new build. Both already refuse while music is loaded or a
 * field holds typed text. A trade being built by TAPPING players and picks is neither, so switching
 * to another app mid-trade reloaded the page and the builder came back empty — reported 2026-11-19
 * on /core/trades, on a day with a deploy every ~20 minutes.
 *
 * A component holding such work calls `holdUnsavedWork()` and releases when the work is gone. A
 * counter, not a flag, so two holders cannot release each other's hold. The next link the reader
 * clicks still picks up the new build — a navigation they chose.
 */
import { useEffect } from 'react'

let holds = 0

export function holdUnsavedWork(): () => void {
  holds += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
  }
}

export function hasUnsavedWork(): boolean {
  return holds > 0
}

/** Hold while `active` is true. Call it unconditionally, above any early return. */
export function useHoldUnsavedWork(active: boolean): void {
  useEffect(() => (active ? holdUnsavedWork() : undefined), [active])
}
