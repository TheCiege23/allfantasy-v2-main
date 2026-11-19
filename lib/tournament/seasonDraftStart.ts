import 'server-only'
import { prisma } from '@/lib/prisma'
import { withControlLock } from '@/lib/draft/draftLock'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { seasonDraftSessionError } from './seasonDraftBoard'
import { loadSeasonDraftContext, readSeasonDraftSnapshot } from './seasonDraftRuntime'
import { refreshSeasonDraftPool } from './seasonDraftRefresh'
import { lockAndCheckSeasonRecovery, newestSeasonEvent, seasonRecoveryHeld } from './seasonRecoveryState'
import { hasSeasonDraftRelease } from './seasonDraftReleaseGate'
import { loadSeasonStage } from './seasonRounds'
import { SEASON_CUT_FINALIZED } from './seasonReportPublication'

/** Native rooms retain their frozen settings and separate start authority. */
export async function startSeasonDraft(
  leagueId: string,
  now = new Date(),
  refresh = refreshSeasonDraftPool,
): Promise<boolean | null> {
  const context = await loadSeasonDraftContext(leagueId)
  if (!context) return null
  if (await seasonRecoveryHeld(prisma, context.tournamentId)) return false
  const window = context.draftWindow
  if (now.getTime() < Date.parse(window.startsAt) || now.getTime() >= Date.parse(window.completeBy)) return false
  const sessionId = seasonResourceId(context.freezeId, context.pool.key + ':draft')
  const session = await prisma.draftSession.findUnique({ where: { id: sessionId } })
  const opening = context.stage === 1
  const requiredStatus = opening ? 'pre_draft' : 'tournament_setup_blocked'
  if (opening) {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!league || !await hasSeasonDraftRelease(leagueId, league.settings)) return false
  }
  if (session?.status === 'in_progress') return true
  if (!session || session.status !== requiredStatus || seasonDraftSessionError(context, session)) return false
  if (!(await refresh(leagueId))?.ready) return false

  const lock = await withControlLock(leagueId, () => prisma.$transaction(async tx => {
    if (await lockAndCheckSeasonRecovery(tx, context.tournamentId)) return false
    const current = await loadSeasonDraftContext(leagueId, tx)
    const snapshot = current && await readSeasonDraftSnapshot(leagueId, context.manifestHash, tx, current)
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { locked: true, emergencyPaused: true, lifecycleState: true, settings: true } })
    const binding = await tx.tournamentLeague.findUnique({ where: { leagueId }, include: { round: true, tournament: { select: { currentRoundNumber: true, status: true } } } })
    if (!current || current.manifestHash !== context.manifestHash || !snapshot || Date.parse(snapshot.expiresAt) <= now.getTime() ||
        !league?.locked || league.emergencyPaused || league.lifecycleState !== (opening ? 'pre_draft' : 'setup') || binding?.draftSessionId !== sessionId || binding.draftScheduledAt?.getTime() !== Date.parse(window.startsAt) ||
        binding.round.roundNumber !== context.stage || binding.tournament.currentRoundNumber !== context.stage ||
        binding.tournament.status !== 'rules_published' || binding.round.status !== 'drafting') return false

    if ((await loadSeasonStage(context.tournamentId, context.stage, tx))?.id !== context.freezeId) return false
    if (opening && (binding.status !== 'season_draft_ready' || !await hasSeasonDraftRelease(leagueId, league.settings, tx))) return false
    const cut = opening ? null : await tx.tournamentAuditLog.findFirst({
      where: { tournamentId: context.tournamentId, roundNumber: context.stage - 1, action: SEASON_CUT_FINALIZED },
      orderBy: newestSeasonEvent,
      select: { id: true },
    })
    if (!opening && (!cut || binding.status !== 'season_setup_blocked')) return false

    const policy = context.config.rules!.draftPolicy!
    const auction = session.draftType === 'auction'
    const clock = auction ? policy.nominationClockSeconds : policy.pickClockSeconds
    const timerEndAt = new Date(now.getTime() + clock * 1000)
    const claimed = await tx.draftSession.updateMany({
      where: { id: sessionId, leagueId, version: session.version, status: requiredStatus },
      data: {
        status: 'in_progress', startedAt: now, timerEndAt, version: { increment: 1 },
        ...(auction ? {
          auctionState: { nominationOrderIndex: 0, currentNomination: null, currentBid: 0, currentBidderRosterId: null, bidTimerEndAt: timerEndAt.toISOString(), minNextBid: 1 },
          auctionBudgets: Object.fromEntries(context.rosterIds.map(id => [id, policy.auctionBudget!])),
        } : {}),
      },
    })
    if (!claimed.count) return false
    if (cut) {
      await tx.tournamentAuditLog.create({ data: {
        id: seasonResourceId(sessionId, 'released'), tournamentId: context.tournamentId, actorType: 'system',
        action: 'season_redraft_released', targetType: 'league', targetId: leagueId, roundNumber: context.stage, createdAt: now,
        data: { version: 1, stage: context.stage, cutId: cut.id, freezeId: context.freezeId, manifestHash: context.manifestHash,
          publicationId: context.publicationId, key: context.pool.key, leagueId, draftId: sessionId, seasonLaunchReady: false },
      } })
    }
    await tx.league.update({ where: { id: leagueId }, data: { lifecycleState: 'drafting' } })
    await tx.tournamentLeague.update({ where: { leagueId }, data: { status: 'drafting' } })
    await tx.tournamentAuditLog.create({ data: {
      id: seasonResourceId(sessionId, 'started'), tournamentId: context.tournamentId, actorType: 'system',
      action: 'season_draft_started', targetType: 'league', targetId: leagueId,
      data: { sessionId, stage: context.stage, startedAt: now.toISOString(), scheduledAt: window.startsAt, completeBy: window.completeBy, manifestHash: context.manifestHash },
    } })
    return true
  }, { maxWait: 5_000, timeout: 15_000 }))
  return lock.acquired ? lock.value : false
}
