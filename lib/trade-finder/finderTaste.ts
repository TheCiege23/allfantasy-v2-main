/**
 * 🛑 THE TRADE FINDER'S FREE TASTE (owner's decision 2026-11-27).
 *
 * A viewer without the Trade Finder plan (`trade_finder` core depth: AF Pro, AF Supreme) sees the TOP idea
 * in full and a lock card for the rest — instead of a hard 403. The cut is made on the SERVER: the
 * locked items are never sent, only how many there were. A client that hid them would be a client-only
 * gate, which is what the 2026-09-24 audit found everywhere.
 *
 * Client-safe (no server imports): the response type is shared with the screens.
 */
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'

/** How many ideas a viewer without the plan sees in full. */
export const TRADE_FINDER_FREE_TASTE = 1

export type FinderTasteLock = {
  /** The depth access the lock card is drawn from (plan name, upgrade path). */
  access: CoreDepthAccess
  /** Ideas sent in full. */
  shown: number
  /** Ideas the server found and did NOT send. */
  lockedCount: number
}

export function finderTaste<T>(items: readonly T[], access: CoreDepthAccess): { items: T[]; lock: FinderTasteLock | null } {
  if (access.unlocked) return { items: [...items], lock: null }
  const shown = items.slice(0, TRADE_FINDER_FREE_TASTE)
  return {
    items: shown,
    lock: { access, shown: shown.length, lockedCount: Math.max(0, items.length - shown.length) },
  }
}
