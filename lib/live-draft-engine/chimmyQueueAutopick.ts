import 'server-only'

import { prisma } from '@/lib/prisma'
import { rosterManagerKey } from '@/lib/league/rosterManager'
import { getViewerAutopickPreference } from '@/lib/live-draft-engine/LiveDraftAutopickPreferenceService'

/**
 * "Chimmy Queue" auto-pick (`LiveDraftAutopickPreference.mode = 'ai_queue'`, AF Pro) for the manager
 * of this roster in this draft.
 *
 * Until 2026-11-23 the mode was stored, Pro-gated and announced ("Chimmy queue autopick is enabled")
 * but nothing at pick time read it, so a Pro manager who chose it got exactly the Standard pick.
 * What it does now: the manager's queue still goes first, unchanged; when the queue gives no pick,
 * Chimmy picks for this team's needs (the draft helper's need-based recommendation) instead of the
 * league's plain best-available-by-ADP fallback.
 *
 * Pro lapsing is handled by `getViewerAutopickPreference`, which reads a Pro mode back as `standard`.
 */
export async function personalChimmyQueueOn(draftSessionId: string, rosterId: string): Promise<boolean> {
  const roster = await prisma.roster.findUnique({ where: { id: rosterId }, select: { platformUserId: true, managerUserId: true } })
  const userId = (roster ? rosterManagerKey(roster) : null) ?? ''
  if (!userId || userId.startsWith('orphan-') || userId.startsWith('ai-manager-')) return false
  const pref = await getViewerAutopickPreference(draftSessionId, userId)
  return pref.enabled && pref.mode === 'ai_queue'
}
