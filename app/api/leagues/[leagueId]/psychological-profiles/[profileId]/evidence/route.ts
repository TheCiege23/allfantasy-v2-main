import { NextResponse } from 'next/server'
import { getProfileById, listProfileEvidence } from '@/lib/psychological-profiles/ManagerBehaviorQueryService'
import { resolveProfileAccess, presentProfile } from '@/lib/psychological-profiles/ProfileAccess'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/psychological-profiles/[profileId]/evidence
 * Query: season?, limit?
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string; profileId: string }> }
) {
  try {
    const { leagueId, profileId } = await ctx.params
    if (!profileId) return NextResponse.json({ error: 'Missing profileId' }, { status: 400 })

    // Evidence records are the raw behaviour behind the labels — the most
    // detailed form of the profile. This route was missed when the other five
    // psychology endpoints were gated, so the gate was walkable: anyone holding a
    // profile id could read what the profile itself would not show them.
    const access = await resolveProfileAccess(leagueId)
    if (!access.ok) {
      return NextResponse.json({ error: access.reason }, { status: access.status })
    }

    const profile = await getProfileById(profileId)
    if (!profile || profile.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Own evidence is free; a leaguemate's is the premium half, exactly as on the
    // profile itself.
    const presented = presentProfile(profile, access)
    if ('locked' in presented) {
      return NextResponse.json(
        {
          profileId,
          leagueId,
          evidence: [],
          locked: true,
          lockedReason: presented.lockedReason,
        },
        { status: 200 }
      )
    }

    const url = new URL(req.url)
    const seasonParam = url.searchParams?.get('season')
    const season = seasonParam != null ? parseInt(seasonParam, 10) : undefined
    const limitParam = url.searchParams?.get('limit')
    const limit = limitParam != null ? Math.min(parseInt(limitParam, 10) || 100, 300) : 100

    const evidence = await listProfileEvidence(profileId, {
      limit,
      season: Number.isNaN(season ?? NaN) ? undefined : season,
    })
    return NextResponse.json({ profileId, leagueId, evidence })
  } catch (e) {
    console.error('[psychological-profiles/[profileId]/evidence GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load profile evidence' },
      { status: 500 }
    )
  }
}
