import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateNflRedraftPlayoffRuntimeBracket } from '@/lib/playoff-runtime'

export const dynamic = 'force-dynamic'

async function canManageLeague(leagueId: string, userId: string): Promise<boolean> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      userId: true,
      teams: {
        where: { claimedByUserId: userId },
        select: { isCommissioner: true, isCoCommissioner: true },
      },
    },
  })
  if (!league) return false
  if (league.userId === userId) return true
  return (league.teams as { isCommissioner: boolean; isCoCommissioner: boolean }[]).some(
    (t) => t.isCommissioner || t.isCoCommissioner,
  )
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { seasonId?: string; playoffTeams?: number; regenerate?: boolean; lockBracket?: boolean }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const seasonId = body.seasonId?.trim()
  if (!seasonId) return NextResponse.json({ error: 'seasonId required' }, { status: 400 })

  const season = await prisma.redraftSeason.findFirst({
    where: { id: seasonId },
    include: {
      rosters: {
        orderBy: [{ playoffSeed: 'asc' }, { wins: 'desc' }, { pointsFor: 'desc' }, { pointsAgainst: 'asc' }],
      },
      playoffBracket: true,
      playoffRounds: {
        orderBy: { roundNumber: 'asc' },
        include: {
          matchups: {
            orderBy: { matchupNumber: 'asc' },
          },
        },
      },
    },
  })
  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })

  const allowed = await canManageLeague(season.leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const result = await generateNflRedraftPlayoffRuntimeBracket({
      seasonId,
      playoffTeams: body.playoffTeams,
      regenerate: body.regenerate,
      lockBracket: body.lockBracket,
      actorUserId: userId,
      preloadedSeason: season,
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate playoff bracket'
    const status = message.includes('not_nfl_redraft') ? 400 : message.includes('not_found') ? 404 : 409
    return NextResponse.json({ error: message }, { status })
  }
}
