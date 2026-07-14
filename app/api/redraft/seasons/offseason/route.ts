import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { enterRedraftOffseason } from '@/lib/redraft/offseason/RedraftOffseasonService'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { seasonId?: string } | null
  const seasonId = body?.seasonId?.trim()
  if (!seasonId) return NextResponse.json({ error: 'seasonId required' }, { status: 400 })

  const season = await prisma.redraftSeason.findUnique({
    where: { id: seasonId },
    select: {
      leagueId: true,
      league: {
        select: {
          userId: true,
          teams: {
            where: { claimedByUserId: userId },
            select: { isCommissioner: true, isCoCommissioner: true },
          },
        },
      },
    },
  })
  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })
  const allowed = season.league.userId === userId || season.league.teams.some((team) => team.isCommissioner || team.isCoCommissioner)
  if (!allowed) return NextResponse.json({ error: 'Forbidden - commissioner only' }, { status: 403 })

  const result = await enterRedraftOffseason(seasonId, userId)
  if (!result.ok) {
    const status = result.code === 'SEASON_NOT_FOUND' ? 404 : 409
    return NextResponse.json({ error: result.code }, { status })
  }
  return NextResponse.json(result)
}