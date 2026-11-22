import { NextRequest, NextResponse } from 'next/server'
import { getAdvanceReadiness } from '@/lib/tournament-mode/advanceReadiness'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeWeeklyPointsByTlpId } from '@/lib/tournament/computeTournamentWeeklyPoints'
import { canViewStandings } from '@/lib/tournament/shellAccess'
import { condenseRound } from '@/lib/tournament-mode/TournamentAdvancementService'
import { runQualificationAdvancement } from '@/lib/tournament-mode/TournamentProgressionService'
import { emitTournamentNotification } from '@/lib/tournament-mode/TournamentNotificationEmitter'
import { DEFAULT_TOURNAMENT_SETTINGS } from '@/lib/tournament-mode/constants'
import type { TournamentSettings } from '@/lib/tournament-mode/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id ?? null

  const { tournamentId: pathId } = await params
  const tournamentId = pathId || req.nextUrl.searchParams?.get('tournamentId')?.trim()
  if (!tournamentId) return NextResponse.json({ error: 'tournamentId required' }, { status: 400 })

  const roundNumber = req.nextUrl.searchParams?.get('roundNumber')
  const conferenceId = req.nextUrl.searchParams?.get('conferenceId')?.trim()
  const participantId = req.nextUrl.searchParams?.get('participantId')?.trim()

  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const allowed = await canViewStandings(tournamentId, userId, shell.standingsVisibility)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (participantId) {
    const p = await prisma.tournamentParticipant.findFirst({
      where: { id: participantId, tournamentId },
    })
    if (!p) return NextResponse.json({ error: 'Participant not found' }, { status: 404 })
    if (userId !== p.userId && userId !== shell.commissionerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const parts = await prisma.tournamentLeagueParticipant.findMany({
      where: { participantId: p.id },
      include: { league: true },
    })
    return NextResponse.json({ participant: p, leagueParticipations: parts })
  }

  if (conferenceId) {
    const conf = await prisma.tournamentConference.findFirst({
      where: { id: conferenceId, tournamentId },
    })
    if (!conf) return NextResponse.json({ error: 'Conference not found' }, { status: 404 })
    return NextResponse.json({ conference: conf, standingsCache: conf.standingsCache })
  }

  const rn = roundNumber ? parseInt(roundNumber, 10) : null
  const round =
    rn != null && Number.isFinite(rn)
      ? await prisma.tournamentRound.findFirst({ where: { tournamentId, roundNumber: rn } })
      : await prisma.tournamentRound.findFirst({
          where: { tournamentId, roundNumber: shell.currentRoundNumber || 1 },
        })

  if (!round) return NextResponse.json({ error: 'Round not found' }, { status: 404 })

  const leagues = await prisma.tournamentLeague.findMany({
    where: { tournamentId, roundId: round.id },
    include: {
      participants: { include: { participant: { select: { displayName: true, userId: true } } } },
    },
  })

  const weekRaw = req.nextUrl.searchParams?.get('week')?.trim()
  if (weekRaw != null && weekRaw !== '') {
    const w = parseInt(weekRaw, 10)
    if (!Number.isFinite(w)) {
      return NextResponse.json({ error: 'Invalid week' }, { status: 400 })
    }
    if (w < round.weekStart || w > round.weekEnd) {
      return NextResponse.json(
        { error: `week must be between ${round.weekStart} and ${round.weekEnd} for this round` },
        { status: 400 },
      )
    }
    const weekPts = await computeWeeklyPointsByTlpId(
      leagues.map((l) => ({
        leagueId: l.leagueId,
        participants: l.participants.map((p) => ({ id: p.id, redraftRosterId: p.redraftRosterId })),
      })),
      w,
    )
    const leaguesWithWeek = leagues.map((l) => ({
      ...l,
      participants: l.participants.map((p) => ({
        ...p,
        weekPoints: weekPts.get(p.id) ?? 0,
      })),
    }))
    return NextResponse.json({ round, leagues: leaguesWithWeek, weeklyWeek: w })
  }

  return NextResponse.json({ round, leagues })
}

/**
 * POST: Advance the tournament to the next round.
 * - If round 0 (qualification): runs qualification advancement.
 * - If round 1+: condenses current round into fewer leagues.
 * - If resolveBubble: true, resolves bubble teams specifically.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id ?? null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tournamentId } = await params

  // Check commissioner access on Legacy tournament
  const tournament = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    select: { creatorId: true, status: true, settings: true },
  })
  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
  if (tournament.creatorId !== userId) {
    return NextResponse.json({ error: 'Only the commissioner can advance rounds' }, { status: 403 })
  }
  if (tournament.status === 'completed') {
    return NextResponse.json({ error: 'Tournament is already completed' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const resolveBubble = body.resolveBubble === true
  const mergedTourSettings: Partial<TournamentSettings> = {
    ...DEFAULT_TOURNAMENT_SETTINGS,
    ...(typeof tournament.settings === 'object' && tournament.settings !== null
      ? (tournament.settings as Partial<TournamentSettings>)
      : {}),
  }
  const defaultAdvancePerLeague = Math.max(
    1,
    Math.min(11, mergedTourSettings.eliminationAdvancementPerLeague ?? DEFAULT_TOURNAMENT_SETTINGS.eliminationAdvancementPerLeague ?? 6)
  )
  const advancementPerLeague =
    typeof body.advancementPerLeague === 'number' ? body.advancementPerLeague : defaultAdvancePerLeague

  try {
    // Find the current active round
    const activeRound = await prisma.legacyTournamentRound.findFirst({
      where: { tournamentId, status: { in: ['active', 'completed'] } },
      orderBy: { roundIndex: 'desc' },
    })

    // A round is not cut while one of its leagues is drafting, and not before its weeks are played
    // unless the commissioner confirms that (lib/tournament-mode/advanceReadiness.ts).
    const readiness = await getAdvanceReadiness(tournamentId, activeRound?.roundIndex ?? 0)
    if (readiness.blockers.length > 0) {
      return NextResponse.json({ error: readiness.blockers.join(' '), code: 'ROUND_DRAFTING', canConfirm: false }, { status: 409 })
    }
    if (readiness.warnings.length > 0 && body.confirmEarly !== true) {
      return NextResponse.json(
        { error: readiness.warnings.join(' '), code: 'ROUND_NOT_FINISHED', canConfirm: true },
        { status: 409 },
      )
    }

    if (!activeRound || activeRound.roundIndex === 0) {
      // Qualification round — run qualification advancement
      if (resolveBubble) {
        // Bubble resolution is handled as part of qualification advancement
        const result = await runQualificationAdvancement(tournamentId)
        await emitTournamentNotification({
          tournamentId,
          event: 'BUBBLE_RESOLVED',
          meta: { bubblesAdvanced: result.bubbleAdvanced },
        })
        await emitTournamentNotification({
          tournamentId,
          event: 'ROUND_ADVANCED',
          meta: { newRoundIndex: 1, advanced: result.advanced, eliminated: result.eliminated },
        })
        return NextResponse.json(result)
      }

      const result = await runQualificationAdvancement(tournamentId)
      await emitTournamentNotification({
        tournamentId,
        event: 'ROUND_ADVANCED',
        meta: { newRoundIndex: 1, advanced: result.advanced, eliminated: result.eliminated },
      })
      return NextResponse.json(result)
    }

    // Later rounds — condense
    const result = await condenseRound(tournamentId, activeRound.roundIndex, advancementPerLeague)

    if (result.phase === 'championship') {
      await emitTournamentNotification({
        tournamentId,
        event: 'CHAMPIONSHIP_FORMED',
        meta: { playerCount: result.advanced },
      })
    } else {
      await emitTournamentNotification({
        tournamentId,
        event: 'ROUND_ADVANCED',
        meta: { newRoundIndex: result.newRoundIndex, advanced: result.advanced, eliminated: result.eliminated, phase: result.phase },
      })
    }

    await emitTournamentNotification({
      tournamentId,
      event: 'REDRAFT_SCHEDULED',
      meta: { roundIndex: result.newRoundIndex },
    })

    return NextResponse.json(result)
  } catch (e) {
    console.error('[tournament/advance] Error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Advancement failed' },
      { status: 500 }
    )
  }
}

