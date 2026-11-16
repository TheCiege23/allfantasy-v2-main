import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getReputationRuntimeConfig,
  upsertReputationRuntimeConfig,
} from '@/lib/reputation-engine/ReputationConfigService'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    const url = new URL(req.url)
    const sport = url.searchParams?.get('sport') ?? undefined
    const seasonRaw = url.searchParams?.get('season')
    const seasonParsed = seasonRaw != null ? parseInt(seasonRaw, 10) : NaN
    const season =
      Number.isFinite(seasonParsed) && !Number.isNaN(seasonParsed) ? seasonParsed : undefined

    const config = await getReputationRuntimeConfig({ leagueId, sport, season })
    return NextResponse.json({ leagueId, config })
  } catch (e) {
    console.error('[reputation/config GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load reputation config' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    try {
      await assertCommissionerAccess(leagueId, userId, 'league')
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as Partial<{
      sport: string
      season: number | string
      tierThresholds: Record<string, { min: number; max?: number }>
      scoreWeights: Record<string, number>
    }>
    const seasonCandidate =
      typeof body?.season === 'number'
        ? body.season
        : typeof body?.season === 'string'
          ? parseInt(body.season, 10)
          : NaN
    const season =
      Number.isFinite(seasonCandidate) && !Number.isNaN(seasonCandidate) ? seasonCandidate : undefined

    const config = await upsertReputationRuntimeConfig({
      leagueId,
      sport: body?.sport,
      season,
      tierThresholds: body?.tierThresholds ?? null,
      scoreWeights: body?.scoreWeights ?? null,
    })
    return NextResponse.json({ leagueId, config })
  } catch (e) {
    console.error('[reputation/config PATCH]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to update reputation config' },
      { status: 500 }
    )
  }
}
