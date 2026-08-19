import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { sessionKeyMock } from '@/lib/draft/session-key'
import { buildMockPickOrder, randomInviteCode } from '@/lib/draft/pick-order'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const sport = typeof body?.sport === 'string' ? body.sport : 'NFL'
  const numTeams = Math.min(32, Math.max(2, Number(body?.numTeams) || 12))
  const numRounds = Math.min(30, Math.max(1, Number(body?.numRounds) || 15))
  const timerSeconds = Math.min(600, Math.max(10, Number(body?.timerSeconds) || 60))
  const scoringType = typeof body?.scoringType === 'string' ? body.scoringType : 'PPR'
  const playerPool = typeof body?.playerPool === 'string' ? body.playerPool : 'all'
  const leagueIdMeta = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const baseSettings =
    body?.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)
      ? (body.settings as Record<string, unknown>)
      : {}
  const mergedSettings =
    leagueIdMeta ? { ...baseSettings, sourceLeagueId: leagueIdMeta } : baseSettings

  let invite = randomInviteCode()
  for (let attempt = 0; attempt < 5; attempt++) {
    const exists = await prisma.mockDraftRoom.findFirst({ where: { inviteCode: invite }, select: { id: true } })
    if (!exists) break
    invite = randomInviteCode()
  }

  const room = await prisma.mockDraftRoom.create({
    data: {
      createdById: userId,
      sport,
      numTeams,
      numRounds,
      timerSeconds,
      scoringType,
      playerPool,
      inviteCode: invite,
      status: 'waiting',
      draftOrder: buildMockPickOrder(numTeams, userId),
      settings: Object.keys(mergedSettings).length > 0 ? toPrismaJsonInput(mergedSettings) : undefined,
    },
  })

  const sk = sessionKeyMock(room.id)
  const pickOrder = buildMockPickOrder(numTeams, userId)
  const ends = new Date(Date.now() + timerSeconds * 1000)

  await prisma.draftRoomStateRow.create({
    data: {
      id: sk,
      mode: 'mock',
      status: 'waiting',
      currentPick: 1,
      currentRound: 1,
      currentTeamIndex: 0,
      timerEndsAt: ends,
      timerPaused: false,
      pickOrder: pickOrder as object,
      roomId: room.id,
      leagueId: null,
      numTeams,
      numRounds,
      timerSeconds,
    },
  })

  return NextResponse.json({
    roomId: room.id,
    inviteCode: room.inviteCode,
    sessionId: sk,
  })
}
