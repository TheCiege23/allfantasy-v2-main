import 'server-only'

import { prisma } from '@/lib/prisma'
import { getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'

/**
 * Which draft slot is the viewer's, and which ids their picks are filed under — for a NATIVE draft
 * and for one MIRRORED from Sleeper, which file things differently:
 *
 *   | | native | Sleeper mirror (`lib/draft/sleeperSync.ts`) |
 *   |---|---|---|
 *   | `slotOrder[].rosterId` | AF `Roster.id` | Sleeper's roster NUMBER (`slot_to_roster_id`) |
 *   | `DraftPick.rosterId` | AF `Roster.id` | the Sleeper USER id (`picked_by`) |
 *
 * 🛑 CHIMMY MATCHED THE SLOT ON `Roster.id` ONLY (found 2026-11-16), so on every Sleeper-mirrored
 * draft the viewer "could not be matched to a draft slot": no next pick, no Draft OS
 * recommendation, no managers ahead. Draft HQ already matched the claimed team's `externalId` (the
 * Sleeper roster number) against the slot order (`lib/core-app/draftHq.ts`); this does the same, AF
 * id first so a native draft is unchanged.
 *
 * Every read fails soft to "not matched": saying nothing about someone's pick beats attributing a
 * slot to the wrong person.
 */

export type DraftSlotEntry = { slot: number; rosterId: string; displayName: string }

export type ViewerDraftIdentity = {
  /** The AF `Roster.id` (what Draft OS and the auction engine take), when the viewer has one. */
  rosterId: string | null
  /** The viewer's entry in `slotOrder`, or null when no id matched. */
  slotEntry: DraftSlotEntry | null
  /** Every id the viewer's picks may be filed under. Never empty-string, never a guess. */
  pickIds: string[]
}

export async function resolveViewerDraftIdentity(args: {
  leagueId: string
  userId: string
  slotOrder: readonly DraftSlotEntry[]
  isSleeperMirror: boolean
}): Promise<ViewerDraftIdentity> {
  let rosterId: string | null = null
  try {
    rosterId = await getCurrentUserRosterIdForLeague(args.leagueId, args.userId)
  } catch {
    rosterId = null
  }

  let claimed: { externalId: string | null; platformUserId: string | null } | null = null
  try {
    claimed = await prisma.leagueTeam.findFirst({
      where: { leagueId: args.leagueId, claimedByUserId: args.userId },
      select: { externalId: true, platformUserId: true },
    })
  } catch {
    claimed = null
  }

  const byRosterId = rosterId ? args.slotOrder.find((e) => e.rosterId === rosterId) : undefined
  const byExternal = claimed?.externalId ? args.slotOrder.find((e) => e.rosterId === String(claimed!.externalId)) : undefined
  const slotEntry = byRosterId ?? byExternal ?? null

  const ids = new Set<string>()
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) ids.add(v.trim())
  }
  add(rosterId)
  add(slotEntry?.rosterId)
  add(claimed?.externalId)
  add(claimed?.platformUserId)
  if (args.isSleeperMirror) {
    try {
      const profile = await prisma.userProfile.findUnique({ where: { userId: args.userId }, select: { sleeperUserId: true } })
      add(profile?.sleeperUserId)
    } catch {
      // Keep the ids already known.
    }
  }
  return { rosterId, slotEntry, pickIds: [...ids] }
}
