/**
 * lib/draft/syncDraftRoundsToRoster.ts
 *
 * Keeps "rounds = draftable roster spots" true after the ROSTER changes. The draft settings PATCH
 * applies the rule only when the Draft tab is saved, so a commissioner who changed roster positions
 * (e.g. 4 UTIL + 1 SU + 3 BN) and never re-saved the Draft tab kept the old round count in the draft
 * room. The roster-settings routes call this right after saving.
 *
 * Only before the draft starts: an in-progress or finished draft's board is never resized. An AF
 * Commissioner's deliberate override (saved rounds that differed from the computed count BEFORE this
 * roster change) is kept; everyone else follows the roster.
 */

import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getDraftConfigForLeague } from '@/lib/draft-defaults/DraftRoomConfigResolver'
import { updateDraftVariantSettings } from '@/lib/draft-defaults/DraftVariantSettingsHub'
import { getComputedDraftRounds, type ComputedDraftRounds } from '@/lib/draft/computedDraftRounds'

export type DraftRoundsSyncResult =
  | { synced: true; rounds: number; previousRounds: number | null }
  | { synced: false; reason: 'draft_started' | 'no_template' | 'unchanged' | 'manual_override' }

export async function syncDraftRoundsToRoster(
  leagueId: string,
  opts: { before: ComputedDraftRounds | null; keepManualOverride: boolean },
): Promise<DraftRoundsSyncResult> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { status: true },
  })
  if (session && session.status !== 'pre_draft') return { synced: false, reason: 'draft_started' }

  const after = await getComputedDraftRounds(leagueId)
  if (!after) return { synced: false, reason: 'no_template' }

  const saved = (await getDraftConfigForLeague(leagueId).catch(() => null))?.rounds ?? null
  if (saved === after.rounds) return { synced: false, reason: 'unchanged' }
  if (opts.keepManualOverride && saved != null && opts.before && saved !== opts.before.rounds) {
    return { synced: false, reason: 'manual_override' }
  }

  await updateDraftVariantSettings(leagueId, { config: { rounds: after.rounds } })
  await prisma.leagueSettings.updateMany({ where: { leagueId }, data: { rounds: after.rounds } })
  return { synced: true, rounds: after.rounds, previousRounds: saved }
}
