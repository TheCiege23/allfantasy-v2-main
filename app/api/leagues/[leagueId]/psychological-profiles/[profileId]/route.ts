import { NextResponse } from 'next/server'
import { resolveProfileAccess, presentProfile } from '@/lib/psychological-profiles/ProfileAccess'
import { getProfileById, listProfileEvidence } from '@/lib/psychological-profiles/ManagerBehaviorQueryService'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/psychological-profiles/[profileId]
 * Get a single psychological profile by id.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string; profileId: string }> }
) {
  try {
    const { leagueId, profileId } = await ctx.params
    if (!profileId) return NextResponse.json({ error: 'Missing profileId' }, { status: 400 })
    const url = new URL(req.url)
    const includeEvidence = url.searchParams?.get('includeEvidence') === '1'
    const limitParam = url.searchParams?.get('limit')
    const limit = limitParam != null ? Math.min(parseInt(limitParam, 10) || 100, 300) : 100
    const seasonParam = url.searchParams?.get('season')
    const season = seasonParam != null ? parseInt(seasonParam, 10) : undefined

    // Same payload as the list route. Gating that one and leaving this open
    // would make the gate decorative — the profile is one id away.
    const access = await resolveProfileAccess(leagueId)
    if (!access.ok) {
      return NextResponse.json({ error: access.reason }, { status: access.status })
    }

    const found = await getProfileById(profileId)
    if (!found || found.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }
    const profile = presentProfile(found, access)
    // Evidence records are the raw behavioural detail behind the labels, so a
    // locked viewer does not get them either.
    if (!includeEvidence || 'locked' in profile) return NextResponse.json(profile)

    const evidence = await listProfileEvidence(profileId, {
      limit,
      season: Number.isNaN(season ?? NaN) ? undefined : season,
    })
    return NextResponse.json({ ...profile, evidence })
  } catch (e) {
    console.error('[psychological-profiles/[profileId] GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to get profile' },
      { status: 500 }
    )
  }
}
