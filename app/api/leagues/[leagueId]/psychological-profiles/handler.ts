import { NextResponse } from 'next/server'
import {
  listProfilesByLeague,
  getProfileByLeagueAndManager,
  compareManagerProfiles,
  type ManagerPsychProfileView,
} from '@/lib/psychological-profiles/ManagerBehaviorQueryService'
import { normalizeSportForPsych } from '@/lib/psychological-profiles/SportBehaviorResolver'
import {
  resolveProfileAccess,
  presentProfile,
} from '@/lib/psychological-profiles/ProfileAccess'
import { rollUpManagerAcrossLeagues } from '@/lib/psychological-profiles/CrossLeagueRollup'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/psychological-profiles
 * List behavior profiles for the league.
 * Query: sport, managerId (single), managerAId, managerBId, season, limit.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

    const access = await resolveProfileAccess(leagueId)
    if (!access.ok) {
      return NextResponse.json({ error: access.reason }, { status: access.status })
    }
    const canSeeOpponents = access.canSeeOpponents
    const present = (p: ManagerPsychProfileView) => presentProfile(p, access)

    const url = new URL(req.url)
    const sportRaw = url.searchParams?.get('sport')
    const sport = sportRaw ? (normalizeSportForPsych(sportRaw) ?? undefined) : undefined
    const seasonParam = url.searchParams?.get('season')
    const season = seasonParam != null ? parseInt(seasonParam, 10) : undefined
    const managerId = url.searchParams?.get('managerId') ?? undefined
    if (managerId) {
      const profile = await getProfileByLeagueAndManager(leagueId, managerId)
      return NextResponse.json({
        leagueId,
        profile: profile ? present(profile) : null,
      })
    }

    // ?rollup=<managerId> — the same manager across the leagues you SHARE with
    // them. Served from this route rather than a new one; the scope is an
    // intersection so it cannot report behaviour from leagues the caller is not
    // in. Identity across leagues is the platform user id, so the roster id in
    // the query is resolved to it first.
    const rollupManagerId = url.searchParams?.get('rollup') ?? undefined
    if (rollupManagerId) {
      const team = await prisma.leagueTeam.findFirst({
        where: {
          leagueId,
          OR: [{ externalId: rollupManagerId }, { id: rollupManagerId }],
        },
        select: { platformUserId: true },
      })
      if (!team?.platformUserId) {
        return NextResponse.json({
          leagueId,
          rollup: null,
          reason: 'This manager has no platform identity, so they cannot be matched across leagues.',
        })
      }
      const rollup = await rollUpManagerAcrossLeagues({
        viewerUserId: access.userId,
        subjectPlatformUserId: team.platformUserId,
        canSeeOthers: canSeeOpponents,
      })
      return NextResponse.json({ leagueId, rollup })
    }

    const managerAId = url.searchParams?.get('managerAId') ?? undefined
    const managerBId = url.searchParams?.get('managerBId') ?? undefined
    if (managerAId && managerBId) {
      // A comparison is inherently about someone else, so it needs the gate even
      // when one side is the caller.
      if (!canSeeOpponents) {
        return NextResponse.json(
          {
            leagueId,
            comparison: null,
            locked: true,
            lockedReason: 'Comparing managers is a premium capability.',
          },
          { status: 200 }
        )
      }
      const comparison = await compareManagerProfiles(leagueId, managerAId, managerBId, sport)
      return NextResponse.json({ leagueId, sport: sport ?? null, season: season ?? null, comparison })
    }

    const limitParam = url.searchParams?.get('limit')
    const limit = limitParam != null ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50

    const profiles = await listProfilesByLeague(leagueId, {
      sport,
      season: Number.isNaN(season ?? NaN) ? undefined : season,
      limit,
    })
    return NextResponse.json({
      leagueId,
      sport: sport ?? null,
      season: season ?? null,
      opponentsLocked: !canSeeOpponents,
      profiles: profiles.map(present),
    })
  } catch (e) {
    console.error('[psychological-profiles GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to list profiles' },
      { status: 500 }
    )
  }
}
