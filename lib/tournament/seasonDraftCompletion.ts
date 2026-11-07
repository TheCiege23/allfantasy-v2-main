import 'server-only'
import { prisma } from '@/lib/prisma'
import { withControlLock } from '@/lib/draft/draftLock'
import { recordArchiveEvent } from '@/lib/draft-archive/events'
import { isSeasonTournamentDraft } from './seasonDraftMutationGate'
import { assessSeasonDraftCompletion } from './seasonDraftReview'

export type SeasonDraftCompletionOutcome = {
  /** The board is completed (now, or already was). */
  completed: boolean
  /** THIS call made the completed transition. Exactly one caller sees true for a board. */
  transitioned: boolean
  sessionId: string | null
}

/** null delegates ordinary leagues; completion never activates a tournament season. */
export async function completeSeasonDraft(leagueId: string): Promise<boolean | null> {
  const outcome = await completeSeasonDraftWithOutcome(leagueId)
  return outcome === null ? null : outcome.completed
}

/**
 * Same as `completeSeasonDraft`, but says whether this call made the transition. A caller that
 * announces completion (the `draft_ended` notification) must act only on `transitioned`: reading the
 * status before the call and comparing it after let two concurrent completers both see
 * "was not completed, is now" and both announce.
 */
export async function completeSeasonDraftWithOutcome(leagueId: string): Promise<SeasonDraftCompletionOutcome | null> {
  if (!(await isSeasonTournamentDraft(leagueId))) return null
  const notDone: SeasonDraftCompletionOutcome = { completed: false, transitioned: false, sessionId: null }
  const locked = await withControlLock(leagueId, () => prisma.$transaction(async (tx): Promise<SeasonDraftCompletionOutcome> => {
    const review = await assessSeasonDraftCompletion(leagueId, tx)
    if (!review) return notDone
    if (review.state === 'completed') return { completed: true, transitioned: false, sessionId: review.session?.id ?? null }
    const { context, session, boardHash } = review
    if (!review.canCheckpoint || !session || !boardHash) return notDone
    const claimed = await tx.draftSession.updateMany({ where: { id: session.id, version: session.version, status: session.status, timerEndAt: session.timerEndAt }, data: { status: 'completed', timerEndAt: null, pausedRemainingSeconds: null, overnightFrozenPickSeconds: null, pausedByUserId: null, version: { increment: 1 } } })
    if (claimed.count !== 1) return notDone
    await recordArchiveEvent(tx, { ...session, status: 'completed' }, 'complete')
    await tx.tournamentAuditLog.create({ data: { tournamentId: context.tournamentId, actorType: 'system', actorId: null, action: 'season_draft_board_completed', targetType: 'league', targetId: leagueId, data: { version: 1, manifestHash: context.manifestHash, sessionId: session.id, boardHash, totalPicks: review.totalPicks, rosterCount: context.rosterIds.length, previousVersion: session.version, launchReady: false } } })
    return { completed: true, transitioned: true, sessionId: session.id }
  }))
  return locked.acquired ? locked.value : notDone
}
