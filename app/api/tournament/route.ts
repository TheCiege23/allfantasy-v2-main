import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildConferencesAndLeagues, createTournamentShell, type TournamentConfig } from '@/lib/tournament/setupEngine'
import { RetiredConceptError } from '@/lib/league-creation/retiredConcepts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET ?tournamentId=… full state | ?commissionerId=… list shells for that commissioner (must be self). */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tournamentId = req.nextUrl.searchParams?.get('tournamentId')?.trim()
  const commissionerId = req.nextUrl.searchParams?.get('commissionerId')?.trim()

  if (tournamentId) {
    const shell = await prisma.tournamentShell.findUnique({
      where: { id: tournamentId },
      include: {
        conferences: { orderBy: { conferenceNumber: 'asc' } },
        rounds: { orderBy: { roundNumber: 'asc' } },
        participants: { select: { id: true, status: true } },
        tournamentLeagues: {
          select: {
            id: true,
            name: true,
            roundId: true,
            conferenceId: true,
            status: true,
            leagueId: true,
          },
        },
      },
    })
    if (!shell) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (shell.commissionerId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const activeParticipants = shell.participants.filter((p) => p.status !== 'eliminated').length
    return NextResponse.json({
      shell,
      standingsSummary: {
        participantCount: shell.participants.length,
        activeParticipants,
        currentRound: shell.currentRoundNumber,
      },
    })
  }

  if (commissionerId) {
    if (commissionerId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const list = await prisma.tournamentShell.findMany({
      where: { commissionerId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        sport: true,
        status: true,
        maxParticipants: true,
        currentParticipantCount: true,
        createdAt: true,
        _count: { select: { tournamentLeagues: true } },
      },
    })
    return NextResponse.json({ tournaments: list })
  }

  const mine = await prisma.tournamentShell.findMany({
    where: { commissionerId: userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      sport: true,
      status: true,
      createdAt: true,
      _count: { select: { tournamentLeagues: true } },
    },
  })
  return NextResponse.json({ tournaments: mine })
}

/** POST — commissioner creates a tournament shell (then call /setup to build leagues). */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Partial<TournamentConfig> & { autoBuildLeagues?: boolean }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.name?.trim() || !body.sport || body.maxParticipants == null) {
    return NextResponse.json({ error: 'name, sport, maxParticipants required' }, { status: 400 })
  }
  if (body.openingWeekStart == null) {
    return NextResponse.json({ error: 'openingWeekStart required' }, { status: 400 })
  }

  const config: TournamentConfig = {
    name: body.name,
    sport: body.sport,
    maxParticipants: body.maxParticipants,
    conferenceCount: body.conferenceCount ?? 2,
    leaguesPerConference: body.leaguesPerConference ?? 6,
    teamsPerLeague: body.teamsPerLeague ?? 10,
    namingMode: body.namingMode ?? 'hybrid',
    openingWeekStart: body.openingWeekStart,
    bubbleWeek: body.bubbleWeek,
    redraftWeek: body.redraftWeek,
    eliteRedraftWeek: body.eliteRedraftWeek,
    championshipWeek: body.championshipWeek,
    draftType: body.draftType,
    waiverType: body.waiverType,
    advancersPerLeague: body.advancersPerLeague,
    wildcardCount: body.wildcardCount,
    bubbleEnabled: body.bubbleEnabled,
    bubbleSize: body.bubbleSize,
    bubbleScoringMode: body.bubbleScoringMode,
    scoringSystem: body.scoringSystem,
    openingRosterSize: body.openingRosterSize,
    tournamentRosterSize: body.tournamentRosterSize,
    eliteRosterSize: body.eliteRosterSize,
    irEnabled: body.irEnabled,
    tradeEnabled: body.tradeEnabled,
    faabResetOnRedraft: body.faabResetOnRedraft,
    draftClockSeconds: body.draftClockSeconds,
    asyncDraft: body.asyncDraft,
    simultaneousDrafts: body.simultaneousDrafts,
    tiebreakerMode: body.tiebreakerMode,
    standingsVisibility: body.standingsVisibility,
    totalRounds: body.totalRounds,
  }

  try {
    const { id } = await createTournamentShell(userId, config)
    if (body.autoBuildLeagues) {
      await buildConferencesAndLeagues(id, config.namingMode)
    }
    const shell = await prisma.tournamentShell.findUnique({ where: { id } })
    return NextResponse.json({ shell })
  } catch (e) {
    // Retired-concept rejections carry a stable machine-readable code.
    if (e instanceof RetiredConceptError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    }
    const msg = e instanceof Error ? e.message : 'Create failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

