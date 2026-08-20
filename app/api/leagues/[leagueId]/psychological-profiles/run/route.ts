import { NextResponse } from 'next/server'
import { resolveProfileAccess } from '@/lib/psychological-profiles/ProfileAccess'
import { runPsychologicalProfileEngine } from '@/lib/psychological-profiles/PsychologicalProfileEngine'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'

/**
 * POST /api/leagues/[leagueId]/psychological-profiles/run
 * Run the psychological profile engine for one manager.
 * Body: { managerId, sport?, season?, sleeperUsername?, rosterId? }.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

    // Generating a profile is compute spend and a database write. It was callable by anyone
    // holding a league id. Membership is required; the premium gate is not, since
    // running the engine is how a member gets their own free profile.
    const access = await resolveProfileAccess(leagueId)
    if (!access.ok) {
      return NextResponse.json({ error: access.reason }, { status: access.status })
    }

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { sport: true, season: true },
    })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    const body = await req.json().catch(() => ({}))
    const { managerId, sport, season, sleeperUsername, rosterId } = body
    if (!managerId) return NextResponse.json({ error: 'Missing managerId' }, { status: 400 })

    const sportResolved = normalizeToSupportedSport(sport ?? league.sport)
    const seasonParsed =
      typeof season === 'number'
        ? season
        : typeof season === 'string'
          ? parseInt(season, 10)
          : NaN
    const seasonResolved =
      Number.isFinite(seasonParsed) && !Number.isNaN(seasonParsed)
        ? seasonParsed
        : league.season ?? new Date().getFullYear()

    const result = await runPsychologicalProfileEngine({
      leagueId,
      managerId: String(managerId),
      sport: sportResolved,
      season: seasonResolved,
      sleeperUsername,
      rosterId,
    })
    return NextResponse.json({ leagueId, ...result })
  } catch (e) {
    console.error('[psychological-profiles/run POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to run profile engine' },
      { status: 500 }
    )
  }
}
