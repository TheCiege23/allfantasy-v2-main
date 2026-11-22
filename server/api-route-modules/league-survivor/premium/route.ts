import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { upgradePathForPlan } from '@/lib/monetization/upgradeDestination'
import { loadSurvivorPremiumIndex, loadSurvivorPremiumTile, saveSurvivorStoryMode } from '@/lib/survivor/premium/survivorPremiumTileData'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/leagues/[leagueId]/survivor/premium            → every tile's access for this viewer
 * GET /api/leagues/[leagueId]/survivor/premium?tile=<tileId> → one tile's data
 * Premium command-center tiles for the signed-in member. The plan lock is checked here, against
 * the plan the server resolves; a locked tile answers 403 with the plan it needs and no data.
 */
export async function GET(req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; email?: string | null }
  } | null
  const userId = session?.user?.id ?? null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const tileId = new URL(req.url).searchParams.get('tile')
  if (!tileId) {
    const index = await loadSurvivorPremiumIndex({ leagueId, userId, email: session?.user?.email ?? null })
    if (!index) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true, ...index }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const result = await loadSurvivorPremiumTile({ leagueId, userId, email: session?.user?.email ?? null, tileId })
  if (!result.ok) {
    const requiredPlan = result.access?.reason === 'plan_required' ? result.access.requiredPlan ?? null : null
    return NextResponse.json(
      { error: result.error, reason: result.access?.reason ?? null, requiredPlan, upgradePath: requiredPlan ? upgradePathForPlan(requiredPlan) : null },
      { status: result.status },
    )
  }
  return NextResponse.json({ ok: true, ...result.payload }, { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * POST /api/leagues/[leagueId]/survivor/premium?tile=story_mode_controls
 * Saves story mode. The only tile with a write; the same server-side gate as reading it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; email?: string | null }
  } | null
  const userId = session?.user?.id ?? null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  if (new URL(req.url).searchParams.get('tile') !== 'story_mode_controls') return NextResponse.json({ error: 'This tile has nothing to save.' }, { status: 405 })
  const body = await req.json().catch(() => null)
  const result = await saveSurvivorStoryMode({ leagueId, userId, email: session?.user?.email ?? null, body })
  if (!result.ok) {
    const requiredPlan = result.access?.reason === 'plan_required' ? result.access.requiredPlan ?? null : null
    return NextResponse.json({ error: result.error, reason: result.access?.reason ?? null, requiredPlan, upgradePath: requiredPlan ? upgradePathForPlan(requiredPlan) : null }, { status: result.status })
  }
  return NextResponse.json({ ok: true, settings: result.settings })
}
