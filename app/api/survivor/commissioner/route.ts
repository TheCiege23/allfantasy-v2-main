import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { survivorHostGuard } from '@/lib/survivor/survivorHostGuard'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { advancePhase } from '@/lib/survivor/gameStateMachine'
import { processReturnFromExile } from '@/lib/survivor/exileEngine'
import { rebalanceTribes } from '@/lib/survivor/tribeEngine'
import { getSurvivorConfig } from '@/lib/survivor/SurvivorLeagueConfig'
import { enqueueNotification } from '@/lib/survivor/notificationEngine'
import { voidPendingRedraftTradesForRoster } from '@/lib/redraft/voidPendingTradesForElimination'
import { SURVIVOR_IDOL_CATALOG, type SurvivorIdolPowerType } from '@/lib/survivor/survivorIdolSeedingEngine'

export const dynamic = 'force-dynamic'

const PAUSE_ERROR_PREFIX = 'PAUSED:'

/**
 * Wraps requireCommissionerRole (which throws a bare Response) in a
 * NextResponse-friendly async guard. Returns null on success or a
 * NextResponse to return directly on failure.
 */
async function commissionerGuard(leagueId: string, userId: string, allowBlindOperations = false): Promise<NextResponse | null> {
  try {
    await requireCommissionerRole(leagueId, userId)
    if (allowBlindOperations) return null
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

type PausedNeedsSnapshot = {
  needsChallengeLock: boolean
  needsTribalLock: boolean
  needsExileScore: boolean
  needsPhaseAdvance: boolean
  needsWeeklyRecap: boolean
}

/**
 * Single source of truth for PausedNeedsSnapshot shape validation.
 * Accepts anything, returns a typed snapshot or null. Every other
 * parse/coerce helper in this file delegates to this.
 */
function coercePauseSnapshot(value: unknown): PausedNeedsSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot = value as Partial<PausedNeedsSnapshot>
  if (
    typeof snapshot.needsChallengeLock !== 'boolean' ||
    typeof snapshot.needsTribalLock !== 'boolean' ||
    typeof snapshot.needsExileScore !== 'boolean' ||
    typeof snapshot.needsPhaseAdvance !== 'boolean' ||
    typeof snapshot.needsWeeklyRecap !== 'boolean'
  ) {
    return null
  }
  return {
    needsChallengeLock: snapshot.needsChallengeLock,
    needsTribalLock: snapshot.needsTribalLock,
    needsExileScore: snapshot.needsExileScore,
    needsPhaseAdvance: snapshot.needsPhaseAdvance,
    needsWeeklyRecap: snapshot.needsWeeklyRecap,
  }
}

function createPauseError(notes: string, snapshot: PausedNeedsSnapshot): string {
  return `${PAUSE_ERROR_PREFIX}${JSON.stringify({ notes, snapshot })}`
}

/** Parse the legacy `PAUSED:{json}` prefix out of survivor lastError. */
function parsePauseSnapshot(lastError: string | null | undefined): PausedNeedsSnapshot | null {
  if (!lastError?.startsWith(PAUSE_ERROR_PREFIX)) return null
  const rawValue = lastError.slice(PAUSE_ERROR_PREFIX.length).trim()
  if (!rawValue.startsWith('{')) return null
  try {
    const parsed = JSON.parse(rawValue) as { snapshot?: unknown } | null
    return coercePauseSnapshot(parsed?.snapshot)
  } catch {
    return null
  }
}

/** Parse the dedicated pausedSnapshot JSON column. */
function parsePausedSnapshotColumn(
  snapshot: Prisma.JsonValue | null | undefined,
): PausedNeedsSnapshot | null {
  return coercePauseSnapshot(snapshot)
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

  const guard2 = await commissionerGuard(leagueId, userId, action === 'pause_season' || action === 'resume_season')
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

  if (action === 'force_phase') {
    const toPhase = typeof body.toPhase === 'string' ? body.toPhase : ''
    const notes = typeof body.notes === 'string' ? body.notes : undefined
    if (!toPhase) return NextResponse.json({ error: 'toPhase required' }, { status: 400 })
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
    const council = await prisma.survivorTribalCouncil.findFirst({
      where: { id: councilId, leagueId },
    })
    const victim = await prisma.survivorPlayer.findUnique({
      where: { leagueId_userId: { leagueId, userId: eliminateUserId } },
    })
    const prev = council ? { eliminatedUserId: council.eliminatedUserId, eliminatedName: council.eliminatedName } : {}
    await prisma.survivorTribalCouncil.update({
      where: { id: councilId },
      data: {
        eliminatedUserId: eliminateUserId,
        eliminatedName: victim?.displayName ?? '',
        auditLog: { commissionerOverride: true, notes } as object,
      },
    })
    if (victim) {
      await prisma.survivorPlayer.update({
        where: { leagueId_userId: { leagueId, userId: eliminateUserId } },
        data: { playerState: 'eliminated', eliminatedWeek: council?.week ?? victim.eliminatedWeek },
      })
    }
    await log('override_tribal', notes || 'Tribal result overridden', {
      targetUserId: eliminateUserId,
      previousState: prev as object,
      newState: { eliminateUserId },
      week: council?.week,
    })
    return NextResponse.json({ ok: true })
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
    const nextFinal = (existing?.finalScore ?? 0) + adjustmentAmount
    await prisma.survivorWeeklyScore.upsert({
      where: { leagueId_userId_week: { leagueId, userId: targetUserId, week } },
      create: {
        leagueId,
        userId: targetUserId,
        week,
        finalScore: nextFinal,
        fantasyScore: 0,
        correctionApplied: true,
      },
      update: {
        finalScore: nextFinal,
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
    const player = await prisma.sportsPlayer.findFirst({
      where: { sport: 'NBA', OR: [{ id: playerId }, { externalId: playerId }, { sleeperId: playerId }] },
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

  if (action === 'rebalance') {
    const notes = typeof body.notes === 'string' ? body.notes : ''
    await rebalanceTribes(leagueId)
    await log('change_setting', notes || 'Force tribe rebalance', {})
    return NextResponse.json({ ok: true })
  }

  if (action === 'remove_player') {
    const targetUserId = typeof body.userId === 'string' ? body.userId : ''
    const reason = typeof body.reason === 'string' ? body.reason : 'removed'
    if (!targetUserId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const openCouncil = await prisma.survivorTribalCouncil.findFirst({
      where: { leagueId, status: 'voting_open' },
      select: { id: true },
    })
    if (openCouncil) {
      await prisma.survivorVote.deleteMany({ where: { councilId: openCouncil.id } })
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

    await enqueueNotification(leagueId, 'phase_change', {
      recipientRole: 'all',
      title: 'League update',
      body: 'A player has been removed from the season.',
      isSpoilerSafe: true,
      urgency: 'high',
    })

    return NextResponse.json({ ok: true })
  }

  if (action === 'pause_season') {
    const notes = typeof body.notes === 'string' ? body.notes : 'Season paused by commissioner'
    const currentState = await prisma.survivorGameState.findUnique({
      where: { leagueId },
      select: {
        needsChallengeLock: true,
        needsTribalLock: true,
        needsExileScore: true,
        needsPhaseAdvance: true,
        needsWeeklyRecap: true,
      },
    })
    const pausedSnapshot: PausedNeedsSnapshot = {
      needsChallengeLock: currentState?.needsChallengeLock ?? false,
      needsTribalLock: currentState?.needsTribalLock ?? false,
      needsExileScore: currentState?.needsExileScore ?? false,
      needsPhaseAdvance: currentState?.needsPhaseAdvance ?? false,
      needsWeeklyRecap: currentState?.needsWeeklyRecap ?? false,
    }
    await prisma.survivorGameState.update({
      where: { leagueId },
      data: {
        needsChallengeLock: false,
        needsTribalLock: false,
        needsExileScore: false,
        needsPhaseAdvance: false,
        needsWeeklyRecap: false,
        pausedSnapshot: pausedSnapshot as unknown as Prisma.InputJsonValue,
        // Keep the legacy string marker as well so older resume paths
        // that still look at lastError continue to behave, but the
        // authoritative snapshot now lives in pausedSnapshot.
        lastError: createPauseError(notes, pausedSnapshot),
      },
    })
    await log('pause_season', notes)
    await enqueueNotification(leagueId, 'phase_change', {
      recipientRole: 'all',
      title: 'Season Paused',
      body: notes,
      isSpoilerSafe: true,
      urgency: 'high',
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'resume_season') {
    const notes = typeof body.notes === 'string' ? body.notes : 'Season resumed'
    const currentState = await prisma.survivorGameState.findUnique({
      where: { leagueId },
      select: {
        lastError: true,
        pausedSnapshot: true,
        needsChallengeLock: true,
        needsTribalLock: true,
        needsExileScore: true,
        needsPhaseAdvance: true,
        needsWeeklyRecap: true,
      },
    })
    // Authoritative source: the dedicated pausedSnapshot JSON column.
    // Fall back to the legacy lastError-embedded snapshot only if the
    // new column is empty (older paused seasons).
    const dbSnapshot = parsePausedSnapshotColumn(currentState?.pausedSnapshot ?? null)
    const legacySnapshot = parsePauseSnapshot(currentState?.lastError)
    const pausedSnapshot: PausedNeedsSnapshot | null = dbSnapshot ?? legacySnapshot
    const isLegacyPausedState = Boolean(
      !pausedSnapshot &&
        currentState?.lastError?.startsWith(PAUSE_ERROR_PREFIX),
    )
    await prisma.survivorGameState.update({
      where: { leagueId },
      data: {
        needsChallengeLock:
          pausedSnapshot?.needsChallengeLock ?? (isLegacyPausedState ? true : currentState?.needsChallengeLock ?? false),
        needsTribalLock:
          pausedSnapshot?.needsTribalLock ?? (isLegacyPausedState ? true : currentState?.needsTribalLock ?? false),
        needsExileScore:
          pausedSnapshot?.needsExileScore ?? (isLegacyPausedState ? true : currentState?.needsExileScore ?? false),
        needsPhaseAdvance:
          pausedSnapshot?.needsPhaseAdvance ?? (isLegacyPausedState ? true : currentState?.needsPhaseAdvance ?? false),
        needsWeeklyRecap:
          pausedSnapshot?.needsWeeklyRecap ?? (isLegacyPausedState ? false : currentState?.needsWeeklyRecap ?? false),
        pausedSnapshot: Prisma.JsonNull,
        lastError: null,
      },
    })
    await log('resume_season', notes)
    await enqueueNotification(leagueId, 'phase_change', {
      recipientRole: 'all',
      title: 'Season Resumed',
      body: notes,
      isSpoilerSafe: true,
      urgency: 'medium',
    })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

