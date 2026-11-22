/**
 * The shape `lib/waivers/waiverCrowd.ts` reads, and what a Worth adding row may show of it. A separate
 * module because the row renders in a client component and the reader is server-only.
 */

/** Below this many leagues a share is not a fact about the player, so the row shows nothing. */
export const CROWD_MIN_LEAGUES = 5

export type WaiverCrowd = {
  /** Distinct Sleeper leagues (this season) with roster rows on file — the rostered denominator. */
  syncedLeagues: number
  /** Distinct Sleeper leagues with any add in the window — the added denominator. */
  activeLeagues: number
  /** The newest add on file in the window, ISO; "this week" runs through it. */
  through: string | null
  players: Record<string, { rosteredIn: number; addedIn: number }>
}

/** What a row may show: nothing below the population floor, a whole-number percent above it. */
export function crowdLine(
  crowd: WaiverCrowd | null | undefined,
  sleeperId: string | null,
): { rosteredPct: number | null; addedIn: number | null; syncedLeagues: number; activeLeagues: number } | null {
  if (!crowd || !sleeperId) return null
  const p = crowd.players[sleeperId]
  if (!p) return null
  const rosteredPct = crowd.syncedLeagues >= CROWD_MIN_LEAGUES ? Math.round((p.rosteredIn / crowd.syncedLeagues) * 100) : null
  const addedIn = crowd.activeLeagues >= CROWD_MIN_LEAGUES && p.addedIn > 0 ? p.addedIn : null
  if (rosteredPct == null && addedIn == null) return null
  return { rosteredPct, addedIn, syncedLeagues: crowd.syncedLeagues, activeLeagues: crowd.activeLeagues }
}
