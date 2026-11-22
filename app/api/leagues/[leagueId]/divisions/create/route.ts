import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isSupportedSport, normalizeToSupportedSport } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'

/**
 * POST /api/leagues/[leagueId]/divisions/create
 * Body: { tierLevel: number, sport?: string, name?: string }
 * Commissioner only.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissionerAccess(leagueId, userId, 'league')
  } catch {
    return NextResponse.json({ error: 'Forbidden: commissioner only' }, { status: 403 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const tierLevel =
      typeof body.tierLevel === 'number' && Number.isInteger(body.tierLevel)
        ? body.tierLevel
        : 1
    if (tierLevel < 1) {
      return NextResponse.json({ error: 'tierLevel must be a positive integer' }, { status: 400 })
    }

    const sportRaw = typeof body.sport === 'string' ? body.sport.trim() : ''
    const sport =
      sportRaw.length === 0
        ? undefined
        : isSupportedSport(sportRaw)
          ? normalizeToSupportedSport(sportRaw)
          : null
    if (sport === null) {
      return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
    }
    const nameRaw = typeof body.name === 'string' ? body.name.trim() : ''
    const name = nameRaw.length > 0 ? nameRaw.slice(0, 80) : null

    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    const divisionSport = sport ?? normalizeToSupportedSport(league.sport)

    const division = await prisma.leagueDivision.create({
      data: {
        leagueId,
        tierLevel,
        sport: divisionSport,
        name: name || `Tier ${tierLevel}`,
      },
    })

    return NextResponse.json({
      divisionId: division.id,
      leagueId: division.leagueId,
      tierLevel: division.tierLevel,
      sport: division.sport,
      name: division.name,
    })
  } catch (e) {
    console.error('[divisions create POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to create division' },
      { status: 500 }
    )
  }
}
