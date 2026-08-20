import { NextResponse } from 'next/server'
import { resolveProfileAccess } from '@/lib/psychological-profiles/ProfileAccess'
import { prisma } from '@/lib/prisma'
import { runPsychologicalProfileEngine } from '@/lib/psychological-profiles/PsychologicalProfileEngine'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'

/**
 * POST /api/leagues/[leagueId]/psychological-profiles/run-all
 * Run the psychological profile engine for every team/manager in the league.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

    // Profiles the entire league — the most expensive endpoint here. It was callable by anyone
    // holding a league id. Membership is required; the premium gate is not, since
    // running the engine is how a member gets their own free profile.
    const access = await resolveProfileAccess(leagueId)
    if (!access.ok) {
      return NextResponse.json({ error: access.reason }, { status: access.status })
    }

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { teams: true },
    })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    const body = await req.json().catch(() => ({}))
    const sport = normalizeToSupportedSport(body?.sport ?? league.sport)
    const seasonParsed =
      typeof body?.season === 'number'
        ? body.season
        : typeof body?.season === 'string'
          ? parseInt(body.season, 10)
          : NaN
    const season =
      Number.isFinite(seasonParsed) && !Number.isNaN(seasonParsed)
        ? seasonParsed
        : league.season ?? new Date().getFullYear()
    const managerIdsFilter = Array.isArray(body?.managerIds)
      ? new Set(body.managerIds.map((m: unknown) => String(m)))
      : null
    const results: { managerId: string; teamName?: string; ok: boolean; error?: string }[] = []

    for (const team of league.teams) {
      const managerId = team.externalId || team.id
      if (managerIdsFilter && !managerIdsFilter.has(managerId)) continue
      try {
        await runPsychologicalProfileEngine({
          leagueId,
          managerId,
          sport,
          season,
          sleeperUsername: team.ownerName,
          rosterId: undefined,
        })
        results.push({ managerId, teamName: team.teamName ?? team.ownerName, ok: true })
      } catch (err) {
        results.push({
          managerId,
          teamName: team.teamName ?? team.ownerName,
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    const okCount = results.filter((r) => r.ok).length
    return NextResponse.json({
      leagueId,
      sport,
      season,
      total: results.length,
      success: okCount,
      failed: results.length - okCount,
      results,
    })
  } catch (e) {
    console.error('[psychological-profiles/run-all POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to run profiles' },
      { status: 500 }
    )
  }
}
