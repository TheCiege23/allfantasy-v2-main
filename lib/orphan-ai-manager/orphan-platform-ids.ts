/**
 * Pure helpers for orphan / AI-manager roster platformUserId prefixes.
 * Kept prisma-free so client components can import without pulling in lib/prisma.
 */

const ORPHAN_PREFIX = 'orphan-'
const AI_MANAGER_PREFIX = 'ai-manager-'

export function isOrphanPlatformUserId(platformUserId: string): boolean {
  return typeof platformUserId === 'string' && platformUserId.startsWith(ORPHAN_PREFIX)
}

/** The unclaimed seat of a league AllFantasy hosts: `open-slot-<leagueId>-<n>` (lib/league/leagueSeats.ts). */
const OPEN_SLOT_PREFIX = 'open-slot-'

/**
 * A seat's placeholder owner, not a person: an empty seat (`orphan-…` or `open-slot-…`, either of
 * which Chimmy may run) or the older AI-manager form. No account sits behind it, so nothing that
 * needs one — a platform notification, a push — is ever addressed to it.
 *
 * 🛑 `open-slot-` was missing until 2026-11-22. Every survivor "is this castaway Chimmy's?" check
 * reads this, so in a hosted league whose open seats were handed to Chimmy (the "Fill empty slots"
 * button) Chimmy never took its turn at Tribal Council, never played an idol, and its ballots were
 * cast as an absent manager's ("no ballot by the deadline") instead of by its own strategy. Found
 * rehearsing a 12-Chimmy survivor league: 3 of 3 lock-time ballots carried the absentee reason.
 */
export function isSeatPlaceholderUserId(userId: string | null | undefined): boolean {
  return typeof userId === 'string' && (userId.startsWith(ORPHAN_PREFIX) || userId.startsWith(AI_MANAGER_PREFIX) || userId.startsWith(OPEN_SLOT_PREFIX))
}

/** Roster slot run by dispersal-draft AI manager flow (not a human user id). */
export function isAiManagerPlatformUserId(platformUserId: string): boolean {
  return typeof platformUserId === 'string' && platformUserId.startsWith(AI_MANAGER_PREFIX)
}
