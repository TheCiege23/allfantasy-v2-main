/**
 * GET: Guillotine league home summary (survival standings, danger tiers, chopped history, assets).
 * Returns 404 when league is not a guillotine league.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isGuillotineLeague } from '@/lib/guillotine/GuillotineLeagueConfig'
import { buildWeeklySummary } from '@/lib/guillotine/GuillotineWeeklySummaryService'
import { getGuillotineConfig } from '@/lib/guillotine/GuillotineLeagueConfig'
import { getGuillotineEscapesForUser } from '@/lib/share/guillotineEscape'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isGuillotine = await isGuillotineLeague(leagueId)
  if (!isGuillotine) return NextResponse.json({ error: 'Not a guillotine league' }, { status: 404 })

  const weekParam = req.nextUrl.searchParams?.get('week')
  const weekOrPeriod = weekParam ? Math.max(1, parseInt(weekParam, 10)) || 1 : 1

  const [summary, config, myEscapes] = await Promise.all([
    buildWeeklySummary({ leagueId, weekOrPeriod, includeDanger: true }),
    getGuillotineConfig(leagueId),
    // Your escapes from chops that happened — shareable moments (2026-09-14). Never fails the summary.
    getGuillotineEscapesForUser(leagueId, userId).catch(() => []),
  ])

  if (!summary) return NextResponse.json({ error: 'Summary not available' }, { status: 500 })

  return NextResponse.json({
    ...summary,
    myEscapes,
    config: config
      ? {
          eliminationStartWeek: config.eliminationStartWeek,
          eliminationEndWeek: config.eliminationEndWeek,
          teamsPerChop: config.teamsPerChop,
          tiebreakerOrder: config.tiebreakerOrder,
          dangerMarginPoints: config.dangerMarginPoints,
          rosterReleaseTiming: config.rosterReleaseTiming,
        }
      : null,
  })
}
