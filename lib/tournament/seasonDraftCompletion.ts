import 'server-only'
import { prisma } from '@/lib/prisma'
import { withControlLock } from '@/lib/draft/draftLock'
import { recordArchiveEvent } from '@/lib/draft-archive/events'
import { isSeasonTournamentDraft } from './seasonDraftMutationGate'
import { assessSeasonDraftCompletion } from './seasonDraftReview'

/** null delegates ordinary leagues; completion never activates a tournament season. */
export async function completeSeasonDraft(leagueId: string): Promise<boolean | null> {
  if (!(await isSeasonTournamentDraft(leagueId))) return null
  const locked = await withControlLock(leagueId, () => prisma.$transaction(async tx => {
    const review = await assessSeasonDraftCompletion(leagueId, tx)
    if (!review) return false
    if (review.state === 'completed') return true
    const { context, session, boardHash } = review
    if (!review.canCheckpoint || !session || !boardHash) return false
    const claimed = await tx.draftSession.updateMany({ where: { id: session.id, version: session.version, status: session.status, timerEndAt: session.timerEndAt }, data: { status: 'completed', timerEndAt: null, pausedRemainingSeconds: null, overnightFrozenPickSeconds: null, pausedByUserId: null, version: { increment: 1 } } })
    if (claimed.count !== 1) return false
    await recordArchiveEvent(tx, { ...session, status: 'completed' }, 'complete')
    await tx.tournamentAuditLog.create({ data: { tournamentId: context.tournamentId, actorType: 'system', actorId: null, action: 'season_draft_board_completed', targetType: 'league', targetId: leagueId, data: { version: 1, manifestHash: context.manifestHash, sessionId: session.id, boardHash, totalPicks: review.totalPicks, rosterCount: context.rosterIds.length, previousVersion: session.version, launchReady: false } } })
    return true
  }))
  return locked.acquired ? locked.value : false
}
