/**
 * Weekly side contests (lib/side-contests): high score and closest loss.
 *
 *   GET  any member — each finished week's winners and the season's prize money
 *   PUT  { high_score: { enabled, prize }, closest_loss: { enabled, prize } }  commissioner — through
 *        the settings patch, so the co-commissioner MONEY scope and the settings lock apply exactly as
 *        they do to dues and payouts
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { parseSideContestsInput, SIDE_CONTESTS_KEY } from '@/lib/side-contests/sideContests'
import { readSideContestsView } from '@/lib/side-contests/sideContestsService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await readSideContestsView(leagueId, userId)
  if (!result.ok) {
    const error = result.status === 404 ? 'Not found' : 'Forbidden'
    return NextResponse.json({ error }, { status: result.status })
  }
  const { ok: _ok, ...body } = result
  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = parseSideContestsInput(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  return executeLeagueSettingsPatch(userId, { leagueId, settingsMerge: { [SIDE_CONTESTS_KEY]: parsed.value } })
}
