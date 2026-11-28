import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { resolveLeagueAccess } from '@/lib/league-access'
import { loadWeekPlanner, PLANNER_SPORTS } from '@/lib/league/weekPlannerLoad'
import { plannerTeamCode } from '@/lib/league/weekPlanner'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/week-planner?offset=0|1[&team=Toronto Maple Leafs&team=TOR…]
 *
 * Every team's games in this league's scoring week (offset 1: next week), each day's slate size, and
 * which nights are light — for streaming (lib/league/weekPlanner.ts). Members only. A sport without a
 * daily schedule, or a week whose schedule is not synced, answers `planner: null` and the screen
 * shows nothing rather than a partial grid.
 *
 * `team` (repeatable, at most 80): the team names a screen holds for its players, answered in
 * `teamCodes` as the planner's own key for each — feeds spell teams differently ("TOR", "Toronto
 * Maple Leafs"), and the rule that matches them needs the server.
 */
export async function GET(req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveLeagueAccess(leagueId, user.appUserId)
  if (!access?.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true } })
  const sport = String(league?.sport ?? '').toUpperCase()
  if (!league || !PLANNER_SPORTS.includes(sport) || !Number.isInteger(league.season)) {
    return NextResponse.json({ planner: null })
  }
  const params = new URL(req.url).searchParams
  const offset = params.get('offset') === '1' ? 1 : 0
  const teamCodes: Record<string, string> = {}
  for (const raw of params.getAll('team').slice(0, 80)) {
    const c = plannerTeamCode(sport, raw)
    if (c) teamCodes[raw] = c
  }
  try {
    const planner = await loadWeekPlanner({ sport, season: league.season as number, offset })
    return NextResponse.json({ planner, teamCodes }, { headers: { 'Cache-Control': 'private, max-age=120' } })
  } catch (e) {
    console.warn('[week-planner] read failed:', e instanceof Error ? e.name : 'unknown')
    return NextResponse.json({ error: 'Could not load this week’s games right now.' }, { status: 503 })
  }
}
