import 'server-only'
import { prisma } from '@/lib/prisma'
import { withControlLock } from '@/lib/draft/draftLock'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { loadSeasonDraftContext, loadSeasonDraftPlayers } from './seasonDraftRuntime'
import { refreshSeasonDraftPool } from './seasonDraftRefresh'

/** null delegates ordinary leagues to their existing service. Route authorization stays mandatory. */
export async function controlSeasonDraft(leagueId: string, action: 'pause' | 'resume' | 'reset', actorId?: string | null): Promise<boolean | null> {
  const context = await loadSeasonDraftContext(leagueId)
  if (!context) return null
  const policy = context.config.rules?.draftPolicy
  if (!policy) return false
  if (action === 'resume') {
    const paused = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
    if (paused?.status !== 'paused' || !(await refreshSeasonDraftPool(leagueId, actorId ?? undefined))?.ready) return false
  }
  const locked = await withControlLock(leagueId, async () => {
    const session = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
    if (!session || (action === 'pause' ? session.status !== 'in_progress' : action === 'resume' ? session.status !== 'paused' : !['paused', 'in_progress'].includes(session.status))) return false
    if (action === 'resume') {
      try { await loadSeasonDraftPlayers(leagueId, context.config.sport) } catch { return false }
    }
    const now = Date.now()
    const fullClock = session.draftType === 'auction' ? policy.nominationClockSeconds : policy.pickClockSeconds
    const remaining = session.status === 'paused' ? session.pausedRemainingSeconds : session.overnightFrozenPickSeconds ?? (session.timerEndAt ? Math.max(0, Math.ceil((session.timerEndAt.getTime() - now) / 1000)) : fullClock)
    const status = action === 'pause' ? 'paused' : action === 'resume' ? 'in_progress' : session.status
    // Zero remains expired. Reset is the explicit command that grants a full new clock.
    const seconds = action === 'reset' ? fullClock : remaining ?? fullClock
    const timerEndAt = status === 'paused' ? null : new Date(now + seconds * 1000)
    const auction = session.draftType === 'auction' && session.auctionState && typeof session.auctionState === 'object' && !Array.isArray(session.auctionState) ? session.auctionState as Record<string, unknown> : null
    return prisma.$transaction(async tx => {
      const claim = await tx.draftSession.updateMany({ where: { id: session.id, version: session.version, status: session.status, timerEndAt: session.timerEndAt }, data: {
        status, timerSeconds: session.draftType === 'auction' ? session.timerSeconds : fullClock, timerEndAt,
        pausedRemainingSeconds: status === 'paused' ? seconds : null, overnightFrozenPickSeconds: null,
        pausedByUserId: status === 'paused' ? actorId ?? session.pausedByUserId ?? null : null,
        ...(auction ? { auctionState: { ...auction, bidTimerEndAt: timerEndAt?.toISOString() ?? null } as any } : {}),
        version: { increment: 1 },
      } })
      if (claim.count !== 1) return false
      await tx.tournamentAuditLog.create({ data: { tournamentId: context.tournamentId, actorId: actorId ?? null, actorType: actorId ? 'user' : 'system', action: 'season_draft_' + action, targetType: 'league', targetId: leagueId, data: { version: 1, manifestHash: context.manifestHash, sessionId: session.id, previousVersion: session.version, status, remainingSeconds: seconds, timerEndAt: timerEndAt?.toISOString() ?? null, launchReady: false } } })
      return true
    })
  })
  return locked.acquired ? locked.value : false
}
