import { submitPrivateVoteCommand } from '@/lib/survivor/survivorPrivateVoteCommand'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import {
  lockVoting,
  openTribalCouncil,
} from '@/lib/survivor/votingEngine'
import { playIdol } from '@/lib/survivor/idolEngine'
import { executeRocksDraw } from '@/lib/survivor/rocksEngine'
import { removeRosterFromTribeChat } from '@/lib/survivor/SurvivorChatMembershipService'
import { enrollInExile } from '@/lib/survivor/SurvivorExileEngine'
import { enrollJuryMember, shouldJoinJury } from '@/lib/survivor/SurvivorJuryEngine'
import { postLeagueRevealFollowUp, postScrollRevealToTribeChat } from '@/lib/survivor/leagueChatPoster'

import { survivorHostGuard } from '@/lib/survivor/survivorHostGuard'
import { normalizeRevealPacing, revealVisibleCount, toPublicRevealSteps } from '@/lib/survivor/survivorRevealGate'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const due = await prisma.survivorTribalCouncil.findMany({
    where: {
      status: 'voting_open',
      votingDeadline: { lte: new Date() },
    },
  })
  for (const c of due) {
    await lockVoting(c.id).catch(() => {})
  }
  return NextResponse.json({ ok: true, locked: due.length })
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

  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  const action = typeof body.action === 'string' ? body.action : ''
  if (!leagueId || !action) return NextResponse.json({ error: 'leagueId and action required' }, { status: 400 })

  if (!['vote', 'play_idol'].includes(action)) {
    const denied = await survivorHostGuard(leagueId, userId)
    if (denied) return denied
  }

  if (action === 'open') {
    const gate = await assertLeagueCommissioner(leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const week = typeof body.week === 'number' ? body.week : 1
    const tribeId = typeof body.tribeId === 'string' ? body.tribeId : null
    const deadline = typeof body.deadline === 'string' ? new Date(body.deadline) : new Date(Date.now() + 3600000)
    const council = await openTribalCouncil(leagueId, week, tribeId, deadline)
    return NextResponse.json(council)
  }

  if (action === 'vote') {
    const gate = await assertLeagueMember(leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
    const result = await submitPrivateVoteCommand(leagueId, userId, typeof body.message === 'string' ? body.message : '')
    return NextResponse.json(result, { status: result.ok ? 200 : result.status })
  }

  if (action === 'play_idol') {
    const gate = await assertLeagueMember(leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
    const councilId = typeof body.councilId === 'string' ? body.councilId : ''
    const idolId = typeof body.idolId === 'string' ? body.idolId : ''
    const protectedUserId = typeof body.protectedUserId === 'string' ? body.protectedUserId : undefined
    if (!councilId || !idolId) {
      return NextResponse.json({ error: 'councilId and idolId required' }, { status: 400 })
    }
    const council = await prisma.survivorTribalCouncil.findUnique({
      where: { id: councilId, leagueId },
      select: { id: true },
    })
    if (!council) return NextResponse.json({ error: 'Council not found' }, { status: 404 })
    const r = await playIdol(idolId, userId, councilId, protectedUserId)
    if (!r.ok) return NextResponse.json(r, { status: 400 })
    return NextResponse.json(r)
  }

  if (action === 'lock') {
    const gate = await assertLeagueCommissioner(leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const councilId = typeof body.councilId === 'string' ? body.councilId : ''
    if (!councilId) return NextResponse.json({ error: 'councilId required' }, { status: 400 })
    // Confirm the council belongs to the leagueId the commissioner was
    // authorized on — prevents cross-league lock via a foreign councilId.
    const council = await prisma.survivorTribalCouncil.findUnique({
      where: { id: councilId },
      select: { leagueId: true },
    })
    if (!council || council.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Council not found' }, { status: 404 })
    }
    await lockVoting(councilId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'reveal_next') {
    // Verify commissioner on the request's leagueId BEFORE any DB lookup
    // so cross-league councilId probes leak nothing about council existence.
    const gate = await assertLeagueCommissioner(leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const councilId = typeof body.councilId === 'string' ? body.councilId : ''
    if (!councilId) return NextResponse.json({ error: 'councilId required' }, { status: 400 })
    const council = await prisma.survivorTribalCouncil.findUnique({
      where: { id: councilId, leagueId },
      select: { revealSequence: true, isRevealed: true, revealStartsAt: true, revealStep: true },
    })
    if (!council) return NextResponse.json({ error: 'Council not found' }, { status: 404 })
    // Publishing the read (chat post, notification, revote) belongs to revealCouncil; this only
    // paces a read that has started. The stored sequence is never mutated, so Replay keeps working.
    if (!council.isRevealed) return NextResponse.json({ error: 'Publish the Torch Ceremony before reading votes.' }, { status: 409 })
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { survivorRevealMode: true } })
    const total = toPublicRevealSteps(council.revealSequence).length
    const pacing = normalizeRevealPacing(league?.survivorRevealMode)
    const now = new Date()
    const visible = revealVisibleCount({ isRevealed: true, revealStartsAt: council.revealStartsAt, revealStep: council.revealStep, total, pacing, now })
    if (visible >= total) return NextResponse.json({ revealStep: total, visibleSteps: total, totalSteps: total, remaining: 0 })
    const revealStep = visible + 1
    await prisma.survivorTribalCouncil.update({
      where: { id: councilId },
      data: { revealStep },
    })
    return NextResponse.json({ revealStep, visibleSteps: revealStep, totalSteps: total, remaining: total - revealStep })
  }

  if (action === 'eliminate') {
    const gate = await assertLeagueCommissioner(leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const councilId = typeof body.councilId === 'string' ? body.councilId : ''
    if (!councilId) return NextResponse.json({ error: 'councilId required' }, { status: 400 })
    const current = await prisma.survivorTribalCouncil.findUnique({
      where: { id: councilId },
      select: { leagueId: true, closedAt: true, eliminatedRosterId: true, status: true },
    })
    if (!current || current.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Council not found' }, { status: 404 })
    }

    if (current.closedAt) {
      return NextResponse.json({
        ok: true,
        alreadyClosed: true,
        eliminatedRosterId: current.eliminatedRosterId,
        closedAt: current.closedAt,
        status: current.status,
      })
    }

    try {
      await lockVoting(councilId)
      const updated = await prisma.survivorTribalCouncil.findUnique({
        where: { id: councilId },
        select: { eliminatedRosterId: true, closedAt: true, status: true },
      })
      return NextResponse.json({
        ok: true,
        eliminatedRosterId: updated?.eliminatedRosterId ?? null,
        closedAt: updated?.closedAt ?? null,
        status: updated?.status ?? 'completed',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to eliminate'
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  if (action === 'rocks_draw') {
    const gate = await assertLeagueCommissioner(leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const councilId = typeof body.councilId === 'string' ? body.councilId : ''
    if (!councilId) return NextResponse.json({ error: 'councilId required' }, { status: 400 })
    const council = await prisma.survivorTribalCouncil.findUnique({
      where: { id: councilId },
      select: { leagueId: true },
    })
    if (!council) return NextResponse.json({ error: 'Council not found' }, { status: 404 })
    if (council.leagueId !== leagueId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const seed = typeof body.seed === 'string' ? body.seed : undefined
    const result = await executeRocksDraw(councilId, seed)
    if (!result) return NextResponse.json({ error: 'Council is not in a tie state or no eligible drawers' }, { status: 400 })
    return NextResponse.json(result)
  }

  if (action === 'commissioner_resolve_tie') {
    const gate = await assertLeagueCommissioner(leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const councilId = typeof body.councilId === 'string' ? body.councilId : ''
    const eliminateRosterId = typeof body.eliminateRosterId === 'string' ? body.eliminateRosterId : ''
    if (!councilId || !eliminateRosterId) {
      return NextResponse.json({ error: 'councilId and eliminateRosterId required' }, { status: 400 })
    }
    // Scope the lookup by { id, leagueId } so a cross-league councilId
    // probe returns the same 404 as a nonexistent council — no leak.
    const council = await prisma.survivorTribalCouncil.findUnique({
      where: { id: councilId, leagueId },
    })
    if (!council) return NextResponse.json({ error: 'Council not found' }, { status: 404 })
    if (!council.isTie) return NextResponse.json({ error: 'Council is not in a tie state' }, { status: 400 })
    const tiedRosterIds = Array.isArray(council.tiePlayerIds)
      ? council.tiePlayerIds.filter((id): id is string => typeof id === 'string')
      : []
    if (!tiedRosterIds.includes(eliminateRosterId)) {
      return NextResponse.json({ error: 'eliminateRosterId must be one of the tied roster IDs' }, { status: 400 })
    }
    const eliminatedRoster = await prisma.roster.findFirst({
      where: { id: eliminateRosterId, leagueId },
      select: { platformUserId: true },
    })
    const eliminatedSurvivorPlayer = await prisma.survivorPlayer.findFirst({
      where: {
        leagueId,
        OR: [{ redraftRosterId: eliminateRosterId }, { id: eliminateRosterId }],
      },
      select: { userId: true, redraftRosterId: true },
    })
    if (!eliminatedRoster && !eliminatedSurvivorPlayer) {
      return NextResponse.json({ error: 'Eliminated roster not found' }, { status: 404 })
    }
    const resolvedEliminatedRosterId = eliminatedSurvivorPlayer?.redraftRosterId ?? eliminateRosterId
    const eliminatedUserId = eliminatedRoster?.platformUserId ?? eliminatedSurvivorPlayer?.userId ?? null
    const resolvedAt = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.survivorTribalCouncil.update({
        where: { id: councilId },
        data: {
          tiePhase: 'commissioner_resolved',
          eliminatedRosterId: resolvedEliminatedRosterId,
          closedAt: resolvedAt,
          status: 'completed',
        },
      })
      await tx.survivorTribeMember.deleteMany({
        where: { rosterId: resolvedEliminatedRosterId },
      })
      await tx.survivorGameState.updateMany({
        where: { leagueId },
        data: { tribalCompleteAt: resolvedAt, lastError: null },
      })
      await tx.survivorAuditEntry.create({
        data: {
          leagueId,
          week: council.week,
          category: 'tribal_council',
          action: 'commissioner_tie_resolve',
          actorUserId: userId,
          targetUserId: eliminatedUserId ?? null,
          data: { councilId, tiedRosterIds },
          isVisibleToCommissioner: true,
          isVisibleToPublic: false,
          isRevealablePostSeason: true,
        },
      })
    })
    await removeRosterFromTribeChat(leagueId, resolvedEliminatedRosterId).catch(() => {})
    const resolvedTeam = await prisma.leagueTeam.findFirst({
      where: { leagueId, platformUserId: eliminatedUserId ?? '' },
      select: { teamName: true },
    })
    const eliminatedName = resolvedTeam?.teamName?.trim() || 'Eliminated player'
    const attendingTribe = council.attendingTribeId
      ? await prisma.survivorTribe.findUnique({
          where: { id: council.attendingTribeId },
          select: { name: true },
        })
      : null
    const tribeName = attendingTribe?.name?.trim() || 'Merged Tribe'
    if (council.attendingTribeId) {
      await postScrollRevealToTribeChat(
        leagueId,
        council.attendingTribeId,
        tribeName,
        eliminatedName,
        council.week,
      ).catch(() => {})
    }
    await postLeagueRevealFollowUp(leagueId, tribeName, eliminatedName, council.week).catch(() => {})
    if (eliminatedUserId) {
      await enrollInExile(leagueId, resolvedEliminatedRosterId, eliminatedUserId).catch(() => {})
    }
    const joinJury = await shouldJoinJury(leagueId, council.week).catch(() => false)
    if (joinJury && eliminatedUserId) {
      await enrollJuryMember(leagueId, resolvedEliminatedRosterId, council.week).catch(() => {})
    }
    return NextResponse.json({ ok: true, eliminatedRosterId: resolvedEliminatedRosterId })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
