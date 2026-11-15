/**
 * Commissioner draft actions: refused on a draft Sleeper owns, and recorded in the league log (2026-11-15).
 *
 * 🛑 A SLEEPER-MIRRORED DRAFT TOOK COMMISSIONER EDITS AND THEN LOST THEM. A draft imported from Sleeper
 * (`DraftSession.sleeperDraftId`) is rewritten from Sleeper on every sync, so a pick edit, an order change, a reset or
 * a clock change made here looked saved and was silently undone minutes later. Those writes are now refused with a
 * message that says where to make the change.
 *
 * ⚠ THE DRAFT ROOM'S COMMISSIONER TOOLS WROTE NOTHING THE LEAGUE COULD SEE. Pick edits had a commissioner-only audit
 * list; start, pause, timer, skip, swap, reset and order changes had nothing at all. Each one now writes a
 * `draft_commissioner_action` row with the acting commissioner, which the league log shows to members in plain words.
 */
import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { logAction } from '@/server/services/auditService'

export const SLEEPER_MIRRORED_DRAFT_CODE = 'SLEEPER_MIRRORED_DRAFT'
export const SLEEPER_MIRRORED_DRAFT_ERROR = 'This draft runs on Sleeper. Make this change on Sleeper — it syncs here.'
export const DRAFT_COMMISSIONER_ACTION = 'draft_commissioner_action'

/** The league's current draft, when Sleeper owns it; null otherwise (including when there is no draft). */
export async function sleeperMirroredDraftId(leagueId: string): Promise<string | null> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { sleeperDraftId: true },
  })
  return session?.sleeperDraftId ?? null
}

/** The JSON body and status a refused write returns, or null when the draft is ours to edit. */
export async function refuseIfSleeperMirrored(leagueId: string): Promise<{ body: { error: string; code: string }; status: number } | null> {
  const mirrored = await sleeperMirroredDraftId(leagueId)
  return mirrored ? { body: { error: SLEEPER_MIRRORED_DRAFT_ERROR, code: SLEEPER_MIRRORED_DRAFT_CODE }, status: 409 } : null
}

/** Automation ticks the draft room fires on a timer — not a commissioner decision, so not logged. */
const NOT_A_DECISION = new Set(['auction_tick', 'slow_tick', 'keeper_tick'])

export function isLoggedCommissionerDraftAction(action: string): boolean {
  return Boolean(action) && !NOT_A_DECISION.has(action)
}

/**
 * Record one commissioner draft action. Never throws — a log write must not fail the action it describes.
 * `detail` is kept small and member-safe: the log line reads only `action`, `overall`, `rosterId`, `seconds`.
 */
export async function recordCommissionerDraftAction(
  leagueId: string,
  userId: string,
  action: string,
  detail: { overall?: number | null; rosterId?: string | null; seconds?: number | null; source?: string } = {},
): Promise<void> {
  if (!isLoggedCommissionerDraftAction(action)) return
  await logAction({
    leagueId,
    userId,
    actionType: DRAFT_COMMISSIONER_ACTION,
    entityType: 'draft',
    entityId: leagueId,
    metadata: { action, ...detail },
  }).catch(() => {})
}
