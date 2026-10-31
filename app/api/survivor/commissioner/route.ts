import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { setCouncilPaused } from '@/lib/survivor/survivorCouncilPause'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { survivorHostGuard } from '@/lib/survivor/survivorHostGuard'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { advancePhase } from '@/lib/survivor/gameStateMachine'
import { processReturnFromExile } from '@/lib/survivor/exileEngine'
import { runShuffle } from '@/lib/survivor/SurvivorTribeShuffleEngine'
import { overrideTribalResult, readTribalOverrideTarget } from '@/lib/survivor/survivorTribalOverride'
import { getSurvivorConfig } from '@/lib/survivor/SurvivorLeagueConfig'
import { enqueueNotification } from '@/lib/survivor/notificationEngine'
import { voidPendingRedraftTradesForRoster } from '@/lib/redraft/voidPendingTradesForElimination'
import { SURVIVOR_IDOL_CATALOG, type SurvivorIdolPowerType } from '@/lib/survivor/survivorIdolSeedingEngine'
import { readSurvivorLateSeasonSettings, validateSurvivorLateSeasonPatch } from '@/lib/survivor/lateSeasonSettings'
import { maybeTriggerSurvivorTribeShuffleRecommendation } from '@/lib/survivor/SurvivorSitOutEngine'

export const dynamic = 'force-dynamic'

/**
 * Wraps requireCommissionerRole (which throws a bare Response) in a
 * NextResponse-friendly async guard. Returns null on success or a
 * NextResponse to return directly on failure.
 */
async function commissionerGuard(leagueId: string, userId: string, scope?: 'league'): Promise<NextResponse | null> {
  try {
    await requireCommissionerRole(leagueId, userId, scope)
    return survivorHostGuard(leagueId, userId)
  } catch (err) {
    if (err instanceof Response) {
      const body = await err.text().catch(() => '')
      return new NextResponse(body || 'Forbidden', {
        status: err.status,
        headers: { 'content-type': err.headers.get('content-type') ?? 'text/plain' },
      })
    }
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const type = req.nextUrl.searchParams?.get('type')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const guard1 = await commissionerGuard(leagueId, userId)
  if (guard1) return guard1

  if (type === 'tribal_override') {
    // The latest council with a result, who it names, and who could be named instead.
    return NextResponse.json({ target: await readTribalOverrideTarget(leagueId) })
  }

  if (type === 'state') {
    const gs = await prisma.survivorGameState.findUnique({ where: { leagueId } })
    const challenge = gs?.activeChallengeId
      ? await prisma.survivorChallenge.findUnique({ where: { id: gs.activeChallengeId } })
      : null
    return NextResponse.json({
      gameState: gs,
      challengeLocksAt: challenge?.locksAt ?? challenge?.lockAt ?? null,
    })
  }

  const actions = await prisma.survivorCommissionerAction.findMany({
    where: { leagueId },
    orderBy: { executedAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({ actions })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = typeof body.action === 'string' ? body.action.trim() : ''
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  const guard2 = await commissionerGuard(leagueId, userId, 'league')
  if (guard2) return guard2

  const log = async (
    actionType: string,
    description: string,
    extra?: { targetUserId?: string; targetTribeId?: string; previousState?: object; newState?: object; week?: number },
  ) => {
    await prisma.survivorCommissionerAction.create({
      data: {
        leagueId,
        commissionerId: userId,
        actionType,
        description,
        targetUserId: extra?.targetUserId,
        targetTribeId: extra?.targetTribeId,
        previousState: extra?.previousState as object | undefined,
        newState: extra?.newState as object | undefined,
        week: extra?.week,
      },
    })
  }

  // Late-season settings: finalistCount (2|3), mergeNamingMode, exileBossMode (+ fixed score / top N).
  if (action === 'late_season_settings') {
    const parsed = validateSurvivorLateSeasonPatch(body.settings)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    const current = (league?.settings && typeof league.settings === 'object' && !Array.isArray(league.settings) ? league.settings : {}) as Record<string, unknown>
    // The full-season plan schedules eliminations for its finalist count, so that count locks with it.
    if ('finalistCount' in parsed.patch && (current.survivor_full_season_plan ||
      await prisma.draftSession.findFirst({ where: { leagueId, status: { in: ['in_progress', 'paused', 'completed'] } }, select: { id: true } }))) {
      return NextResponse.json({ error: 'The number of finalists locks when the draft starts.' }, { status: 409 })
    }
    await prisma.league.update({ where: { id: leagueId }, data: { settings: { ...current, ...parsed.patch } as object } })
    await log('late_season_settings', 'Updated late-season Survivor settings', { newState: parsed.patch })
    return NextResponse.json({ ok: true, settings: readSurvivorLateSeasonSettings({ ...current, ...parsed.patch }) })
  }

  if (action === 'force_phase') {
    const toPhase = typeof body.toPhase === 'string' ? body.toPhase : ''
    const notes = typeof body.notes === 'string' ? body.notes : undefined
    if (!toPhase) return NextResponse.json({ error: 'toPhase required' }, { status: 400 })
    if (toPhase === 'merge') {
      // An early merge moves the whole cast, so it waits for the open council to finish and runs once.
      const gs = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { activeCouncilId: true, mergeTriggeredAt: true } })
      if (gs?.mergeTriggeredAt) return NextResponse.json({ error: 'The merge has already happened.' }, { status: 409 })
      if (gs?.activeCouncilId) return NextResponse.json({ error: 'Finish the open Tribal Council before starting the merge.' }, { status: 409 })
    }
    await advancePhase(leagueId, 'commissioner', userId, { toPhase, notes })
    await log('force_phase', notes ?? `Advance to ${toPhase}`, { newState: { toPhase } })
    return NextResponse.json({ ok: true })
  }

  if (action === 'override_tribal') {
    const councilId = typeof body.councilId === 'string' ? body.councilId : ''
    const eliminateUserId = typeof body.eliminateUserId === 'string' ? body.eliminateUserId : ''
    const notes = typeof body.notes === 'string' ? body.notes : ''
    if (!councilId || !eliminateUserId) {
      return NextResponse.json({ error: 'councilId and eliminateUserId required' }, { status: 400 })
    }
    // The whole change: the wrong manager back in the game, the right one voted out the normal way.
    const result = await overrideTribalResult({ leagueId, councilId, eliminateUserId, actorUserId: userId, notes })
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
    await log('override_tribal', notes || 'Tribal result overridden', {
      targetUserId: eliminateUserId,
      previousState: { eliminatedUserId: result.reinstatedUserId } as object,
      newState: { eliminateUserId, restoredPlayerIds: result.restoredPlayerIds, claimedElsewherePlayerIds: result.claimedElsewherePlayerIds } as object,
    })
    return NextResponse.json(result)
  }

  if (action === 'grant_return') {
    const targetUserId = typeof body.userId === 'string' ? body.userId : ''
    const notes = typeof body.notes === 'string' ? body.notes : ''
    if (!targetUserId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    const week = typeof body.week === 'number' ? body.week : undefined
    await processReturnFromExile(leagueId, { week })
    await log('grant_return', notes || 'Return from exile (manual)', { targetUserId, week })
    return NextResponse.json({ ok: true })
  }

  if (action === 'adjust_score') {
    const targetUserId = typeof body.userId === 'string' ? body.userId : ''
    const week = typeof body.week === 'number' ? body.week : 0
    const adjustmentAmount = typeof body.adjustmentAmount === 'number' ? body.adjustmentAmount : 0
    const notes = typeof body.notes === 'string' ? body.notes : ''
    if (!targetUserId || !week) {
      return NextResponse.json({ error: 'userId and week required' }, { status: 400 })
    }
    const existing = await prisma.survivorWeeklyScore.findUnique({
      where: { leagueId_userId_week: { leagueId, userId: targetUserId, week } },
    })
    const prev = existing ? { finalScore: existing.finalScore } : {}
    // syncWeeklyScores recomputes finalScore as fantasy + boost - penalty on
    // every tick, so the adjustment must live in boost/penalty to survive it.
    const boost = (existing?.pointBoostApplied ?? 0) + Math.max(0, adjustmentAmount)
    const penalty = (existing?.pointPenaltyApplied ?? 0) + Math.max(0, -adjustmentAmount)
    const nextFinal = (existing?.fantasyScore ?? 0) + boost - penalty
    await prisma.survivorWeeklyScore.upsert({
      where: { leagueId_userId_week: { leagueId, userId: targetUserId, week } },
      create: {
        leagueId,
        userId: targetUserId,
        week,
        finalScore: nextFinal,
        fantasyScore: 0,
        pointBoostApplied: boost,
        pointPenaltyApplied: penalty,
        correctionApplied: true,
      },
      update: {
        finalScore: nextFinal,
        pointBoostApplied: boost,
        pointPenaltyApplied: penalty,
        correctionApplied: true,
      },
    })
    await log('adjust_score', notes || `Adjust score by ${adjustmentAmount}`, {
      targetUserId,
      previousState: prev as object,
      newState: { finalScore: nextFinal },
      week,
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'grant_idol') {
    const targetUserId = typeof body.userId === 'string' ? body.userId : ''
    const powerType = typeof body.powerType === 'string' ? body.powerType : ''
    const playerId = typeof body.playerId === 'string' ? body.playerId.trim() : ''
    const notes = typeof body.notes === 'string' ? body.notes : ''
    const power = SURVIVOR_IDOL_CATALOG[powerType as SurvivorIdolPowerType]
    if (!targetUserId || !playerId || !power) {
      return NextResponse.json({ error: 'A manager, drafted player, and supported idol power are required.' }, { status: 400 })
    }
    const config = await getSurvivorConfig(leagueId)
    if (!config) return NextResponse.json({ error: 'Survivor config missing' }, { status: 400 })
    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: targetUserId },
      select: { id: true, redraftRosterId: true },
    })
    if (!roster?.redraftRosterId) return NextResponse.json({ error: 'Finish the draft before assigning an idol.' }, { status: 422 })
    const [draftedPlayer, existingIdol, league, owner] = await Promise.all([
      prisma.redraftRosterPlayer.findFirst({ where: { rosterId: roster.redraftRosterId, playerId, droppedAt: null }, select: { playerName: true } }),
      prisma.survivorIdol.findFirst({ where: { leagueId, playerId, status: { in: ['hidden', 'revealed'] }, isUsed: false }, select: { id: true } }),
      prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } }),
      prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId: targetUserId } }, select: { idolIds: true, playerState: true } }),
    ])
    if (!draftedPlayer || owner?.playerState !== 'active') return NextResponse.json({ error: 'Choose an active manager’s currently rostered player.' }, { status: 422 })
    if (existingIdol) return NextResponse.json({ error: 'That player already carries an active idol.' }, { status: 409 })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    const leagueSport = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } })
    const player = await prisma.sportsPlayer.findFirst({
      where: { sport: String(leagueSport?.sport ?? 'NFL').toUpperCase(), OR: [{ id: playerId }, { externalId: playerId }, { sleeperId: playerId }] },
      select: { imageUrl: true },
    })
    await prisma.$transaction(async tx => {
      const idol = await tx.survivorIdol.create({
        data: {
          leagueId, configId: config.configId, rosterId: roster.id, playerId,
          powerType: power.powerType, powerLabel: power.label, powerDesc: power.description,
          powerCategory: power.category, status: 'hidden', isSecret: true,
          isPubliclyKnown: false, isUsed: false, isTradable: true,
          currentOwnerUserId: targetUserId, originalOwnerUserId: targetUserId,
          expiresAtMerge: false, validUntilPhase: 'final_5',
          playWindowRule: 'before_reveal',
          auditLog: { assignedSource: 'commissioner_grant', playerId },
        },
      })
      await tx.survivorIdolLedgerEntry.create({
        data: { leagueId, idolId: idol.id, eventType: 'assigned', toRosterId: roster.id, metadata: { source: 'commissioner_grant', playerId, powerType } },
      })
      await tx.survivorPlayer.update({
        where: { leagueId_userId: { leagueId, userId: targetUserId } },
        data: { idolIds: Array.from(new Set([...(owner.idolIds ?? []), idol.id])) },
      })
      await tx.leagueChatMessage.create({
        data: {
          id: `survivor-idol:${idol.id}:notice`, leagueId, userId: league.userId,
          message: `@Chimmy: ${draftedPlayer.playerName} holds your secret ${power.label}. ${power.description} The idol follows that player through trades and waivers.`,
          type: 'system', imageUrl: player?.imageUrl ?? null, isPrivate: true,
          visibleToUserId: targetUserId, messageSubtype: 'chimmy_private',
          metadata: { chimmyPrivateReply: true, survivorIdolReveal: true, idolId: idol.id, playerId, playerName: draftedPlayer.playerName, playerImageUrl: player?.imageUrl ?? null },
        },
      })
    })
    await log('grant_idol', notes || `Granted ${powerType}`, { targetUserId, newState: { powerType, playerId } })
    return NextResponse.json({ ok: true })
  }

  if (action === 'rebalance' || action === 'redraw_tribes') {
    const notes = typeof body.notes === 'string' ? body.notes : ''
    /*
     * The current redraw (SurvivorTribeShuffleEngine.runShuffle): every active manager reassigned and
     * the tribe chats replaced in one transaction, pre-merge and between councils only. `rebalance`
     * used to call the legacy tribeEngine.rebalanceTribes, which moves only `SurvivorTribeMember` rows
     * and never `SurvivorPlayer.tribeId`, the field councils, chats and the redraw itself now read.
     */
    const redraw = await runShuffle(leagueId, { actorUserId: userId })
    if (!redraw.ok) return NextResponse.json({ error: redraw.error ?? 'The tribes could not be redrawn.' }, { status: 409 })
    await log('change_setting', notes || 'Commissioner redrew the tribes', { newState: { tribeCount: redraw.tribes?.length ?? null } as object })
    return NextResponse.json({ ok: true, tribeCount: redraw.tribes?.length ?? null })
  }

  if (action === 'remove_player') {
    const targetUserId = typeof body.userId === 'string' ? body.userId : ''
    const reason = typeof body.reason === 'string' ? body.reason : 'removed'
    if (!targetUserId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    // Clear only the ballots this manager cast or received. Everyone else's stand; anyone whose vote
    // named them can vote again before the deadline.
    const openCouncil = await prisma.survivorTribalCouncil.findFirst({
      where: { leagueId, status: 'voting_open' },
      select: { id: true },
    })
    if (openCouncil) {
      await prisma.survivorVote.deleteMany({ where: { councilId: openCouncil.id, OR: [{ voterUserId: targetUserId }, { targetUserId }] } })
    }

    await prisma.survivorIdol.updateMany({
      where: { leagueId, currentOwnerUserId: targetUserId, isUsed: false },
      data: { status: 'expired', expiredAt: new Date() },
    })

    const r0 = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: targetUserId },
      select: { id: true },
    })
    if (r0) {
      await voidPendingRedraftTradesForRoster(leagueId, r0.id).catch(() => {})
    }

    await prisma.survivorPlayer.updateMany({
      where: { leagueId, userId: targetUserId },
      data: { playerState: 'eliminated' },
    })

    await log('remove_player', reason, { targetUserId, newState: { playerState: 'eliminated' } })
    // A quit can leave a tribe short, exactly like a vote-out: raise the same redraw recommendation.
    const removedWeek = (await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true } }))?.currentWeek
    if (removedWeek) await maybeTriggerSurvivorTribeShuffleRecommendation(leagueId, removedWeek).catch(() => {})

    await enqueueNotification(leagueId, 'phase_change', {
      recipientRole: 'all',
      title: 'League update',
      body: 'A player has been removed from the season.',
      isSpoilerSafe: true,
      urgency: 'high',
    })

    return NextResponse.json({ ok: true })
  }

  if (action === 'pause_season' || action === 'resume_season') {
    const paused = action === 'pause_season'
    const result = await setCouncilPaused(leagueId, userId, paused)
    if (!result.ok) return NextResponse.json(result, { status: result.status })
    if (result.changed) await enqueueNotification(leagueId, 'phase_change', {
      recipientRole: 'all', title: paused ? 'Season Paused' : 'Season Resumed',
      body: paused ? 'Season paused by commissioner' : 'Season resumed', isSpoilerSafe: true, urgency: paused ? 'high' : 'medium',
    })
    return NextResponse.json(result)
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

