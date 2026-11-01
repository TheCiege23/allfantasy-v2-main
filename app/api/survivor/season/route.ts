import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import {
  redactSurvivorSeasonPayloadForFairPlay,
} from '@/lib/survivor/survivorFairPlay'
import { seedIdolsAfterDraft } from '@/lib/survivor/idolEngine'
import { assignPlayersToTribes } from '@/lib/survivor/tribeEngine'
import { readSurvivorVisualThemeId, extractLeadingTribeIcon } from '@/lib/survivor/survivorVisuals'
import { survivorPublicCouncil } from '@/lib/survivor/survivorPublicCouncil'
import { survivorHostGuard } from '@/lib/survivor/survivorHostGuard'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'
import { resolveTribeEmblem } from '@/lib/survivor/survivorTribeIdentity'
import { canSeeExileMembership, exileMembershipHidden, exileSafePlayerState } from '@/lib/survivor/survivorExileSecrecy'

export const dynamic = 'force-dynamic'

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
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : ''
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueCommissioner(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const hostDenied = await survivorHostGuard(leagueId, userId)
  if (hostDenied) return hostDenied

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      survivorMode: true,
      survivorPhase: 'drafting',
      survivorPlayerCount: typeof body.playerCount === 'number' ? body.playerCount : undefined,
      survivorTribeCount: typeof body.tribeCount === 'number' ? body.tribeCount : undefined,
      survivorMergeWeek: typeof body.survivorMergeWeek === 'number' ? body.survivorMergeWeek : undefined,
    },
  })

  await prisma.survivorLeagueConfig.upsert({
    where: { leagueId },
    create: {
      leagueId,
      tribeCount: typeof body.tribeCount === 'number' ? (body.tribeCount as number) : 4,
      tribeSize: typeof body.tribeSize === 'number' ? (body.tribeSize as number) : 5,
    },
    update: {
      tribeCount: typeof body.tribeCount === 'number' ? (body.tribeCount as number) : undefined,
      tribeSize: typeof body.tribeSize === 'number' ? (body.tribeSize as number) : undefined,
    },
  })

  await prisma.exileIsland.upsert({
    where: { leagueId },
    create: { leagueId },
    update: {},
  })

  try {
    await assignPlayersToTribes(leagueId, 'auto')
  } catch {
    /* tribes may already exist — commissioner can re-run tribes route */
  }
  const existingIdols = await prisma.survivorIdol.count({ where: { leagueId } })
  if (existingIdols === 0) {
    await seedIdolsAfterDraft(leagueId, 'random').catch(() => {})
  }

  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access?.isLeagueMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      survivorPhase: true,
      survivorMode: true,
      survivorTribeCount: true,
      survivorMergeWeek: true,
      survivorRevealMode: true,
      settings: true,
      sport: true,
    },
  })
  const tribes = await prisma.survivorTribe.findMany({ where: { leagueId }, include: { members: true } })
  const players = await prisma.survivorPlayer.findMany({ where: { leagueId } })
  const council = await prisma.survivorTribalCouncil.findFirst({
    where: { leagueId, status: { in: ['scheduled', 'voting_open', 'voting_closed', 'closed', 'revealing', 'revealed', 'tie_pending'] } },
    orderBy: [{ week: 'desc' }, { councilNumber: 'desc' }],
  })
  const challenge = await prisma.survivorChallenge.findFirst({
    where: { leagueId, status: { in: ['open', 'locked'] } },
    // The slate (challenge 1 or 2) first; the weekly call (3) has its own card on the challenges page.
    orderBy: [{ week: 'desc' }, { challengeNumber: 'asc' }],
  })
  const exile = await prisma.exileIsland.findUnique({ where: { leagueId } })
  const jury = await prisma.jurySession.findUnique({ where: { leagueId } })
  const me = await prisma.survivorPlayer.findFirst({ where: { leagueId, userId } })
  const gameWeek = (await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true } }))?.currentWeek ?? 0
  const weeklyScores = gameWeek > 0 ? await prisma.survivorWeeklyScore.findMany({
    where: { leagueId, week: gameWeek },
    select: { userId: true, finalScore: true, tribeId: true, countedTowardTribeTotal: true, isFinalized: true },
  }) : []

  const settingsJson =
    league?.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>)
      : {}
  const fairPlayRedact =
    access.isParticipatingCommissioner ||
    Boolean(settingsJson.survivor_commissioner_fair_play_limited_visibility && access.isParticipant)

  // Exiles and a commissioner who is NOT playing may see who is on Exile; everyone else may not.
  const canSeeExile = canSeeExileMembership({ hidden: exileMembershipHidden(league?.settings), viewerState: me?.playerState, nonPlayingCommissioner: Boolean(access.isNonParticipatingCommissionerHost) })
  const payload = {
    exileMembershipHidden: !canSeeExile,
    phase: league?.survivorPhase,
    mode: league?.survivorMode,
    visualThemeId: readSurvivorVisualThemeId((await prisma.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { engineSpecV2: true } }))?.engineSpecV2, leagueId),
    tribes: tribes.map((tribe: (typeof tribes)[number]) => {
      const emblem = resolveTribeEmblem(tribe, String(league?.sport ?? 'NFL'))
      return { ...tribe, emoji: extractLeadingTribeIcon(tribe.name), logoUrl: emblem.crestUrl, markUrl: emblem.markUrl, mascot: emblem.mascot }
    }),
    players: access.decisions.canSeeHiddenIdolAssignments
      ? players.map(p => (canSeeExile ? p : { ...p, playerState: exileSafePlayerState(p.playerState, false) }))
      : players.map(p => ({
      id: p.id, userId: p.userId, displayName: p.displayName, avatarUrl: p.avatarUrl,
      // Exile secrecy: someone not on Exile sees an exiled castaway as simply eliminated.
      tribeId: p.tribeId, playerState: exileSafePlayerState(p.playerState, canSeeExile), eliminatedWeek: p.eliminatedWeek,
      isJuryMember: p.isJuryMember, isFinalist: p.isFinalist,
      hasImmunityThisWeek: p.hasImmunityThisWeek,
    })),
    activeCouncil: survivorPublicCouncil(council, access.decisions.canSeePrivateVotes, { revealMode: league?.survivorRevealMode }),
    currentChallenge: access.decisions.canSeeHiddenIdolAssignments ? challenge : challenge && {
      id: challenge.id, week: challenge.week, title: challenge.title, description: challenge.description,
      instructions: challenge.instructions, scope: challenge.scope, status: challenge.status,
      submissionMode: challenge.submissionMode, challengeType: challenge.challengeType,
      locksAt: challenge.locksAt, lockAt: challenge.lockAt, closesAt: challenge.closesAt,
      rewardType: challenge.rewardType, rewardAmount: challenge.rewardAmount,
      resultSummary: challenge.status === 'resolved' ? challenge.resultSummary : null,
    },
    exileStatus: exile,
    exileEnabled: access.settings.exileIslandEnabled !== false,
    juryStatus: access.decisions.canSeePrivateVotes ? jury : jury && {
      id: jury.id, status: jury.status, finalistUserIds: jury.finalistUserIds,
      jurorUserIds: jury.jurorUserIds, questionsDeadline: jury.questionsDeadline, votingDeadline: jury.votingDeadline,
      winnerId: jury.revealedAt ? jury.winnerId : null, winnerName: jury.revealedAt ? jury.winnerName : null,
      revealedAt: jury.revealedAt,
    },
    userState: me,
    weeklyScores,
  }

  if (fairPlayRedact) {
    return NextResponse.json(redactSurvivorSeasonPayloadForFairPlay(payload, userId, me?.tribeId ?? null))
  }

  return NextResponse.json(payload)
}

