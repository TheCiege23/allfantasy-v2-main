/**
 * GET /api/leagues/[leagueId]/simulation-insights
 * Returns league simulation + warehouse + dynasty context for AI surfaces.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getInsightContext,
  getSimulationAndWarehouseContextForLeague,
} from '@/lib/ai-simulation-integration'
import type { InsightType } from '@/lib/ai-simulation-integration'

export const dynamic = 'force-dynamic'

const SUPPORTED_INSIGHT_TYPES: InsightType[] = [
  'matchup',
  'playoff',
  'trade',
  'waiver',
  'draft',
  'dynasty',
]

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { leagueId } = await ctx.params
    if (!leagueId) {
      return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    }

    const seasonRaw = req.nextUrl.searchParams?.get('season')
    const weekRaw = req.nextUrl.searchParams?.get('week')
    const teamId = req.nextUrl.searchParams?.get('teamId') ?? undefined
    const sport = req.nextUrl.searchParams?.get('sport') ?? undefined
    const insightTypeRaw = req.nextUrl.searchParams?.get('insightType') ?? undefined

    const season = seasonRaw != null ? Number.parseInt(seasonRaw, 10) : undefined
    const week = weekRaw != null ? Number.parseInt(weekRaw, 10) : undefined

    const contextData = await getSimulationAndWarehouseContextForLeague(leagueId, {
      season: Number.isFinite(season) ? season : undefined,
      week: Number.isFinite(week) ? week : undefined,
      teamId,
    })

    if (!contextData) {
      return NextResponse.json({ error: 'League context not found' }, { status: 404 })
    }

    const insightType =
      insightTypeRaw && SUPPORTED_INSIGHT_TYPES.includes(insightTypeRaw as InsightType)
        ? (insightTypeRaw as InsightType)
        : undefined

    const insight = insightType
      ? await getInsightContext(leagueId, insightType, {
          season: Number.isFinite(season) ? season : undefined,
          week: Number.isFinite(week) ? week : undefined,
          teamId,
          sport,
        })
      : ''

    return NextResponse.json({
      leagueId,
      insightType: insightType ?? null,
      context: contextData,
      insight,
    })
  } catch (e) {
    console.error('[simulation-insights GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load simulation insights' },
      { status: 500 }
    )
  }
}
