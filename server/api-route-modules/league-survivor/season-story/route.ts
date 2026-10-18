/**
 * GET /api/leagues/[leagueId]/survivor/season-story?season=YYYY — the season story and trophy
 * case (survivor-core handoff §3). League members only; the payload carries public facts only
 * (see lib/survivor/seasonStoryServer.ts).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'
import { loadSeasonStory } from '@/lib/survivor/seasonStoryServer'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access?.isLeagueMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const raw = req.nextUrl.searchParams.get('season')
  const season = raw && /^\d{4}$/.test(raw) ? Number(raw) : null
  const view = await loadSeasonStory(leagueId, season)
  if (!view) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } })
}
