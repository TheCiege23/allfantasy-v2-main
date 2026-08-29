/**
 * GET: Fetch AI ADP for a segment (sport, leagueType, formatKey).
 * Used by draft room when commissioner has enabled AI ADP; also for player list integration.
 * Query: sport, leagueType?, formatKey?
 * Response includes entries, totalDrafts, totalPicks, computedAt, lowSampleThreshold; lowSample flag on each entry.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAiAdp } from '@/lib/ai-adp-engine'
import { isAiAdpConsumerEnabled } from '@/lib/ai-adp-engine/aiAdpConsumerFlag'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sport = normalizeToSupportedSport(req.nextUrl.searchParams?.get('sport') ?? 'NFL')
  const leagueType = (req.nextUrl.searchParams?.get('leagueType') ?? 'redraft').toLowerCase()
  const formatKey = (req.nextUrl.searchParams?.get('formatKey') ?? 'default').toLowerCase()
  const limit = Math.min(parseInt(req.nextUrl.searchParams?.get('limit') ?? '300', 10), 500)

  /*
   * 🛑 THE READ IS GATED, NOT THE WRITE. `runAiAdpJob` is now scheduled, so this table
   * stops being empty — and every consumer changes behaviour the moment it has rows. See
   * lib/ai-adp-engine/aiAdpConsumerFlag.ts for why that is not yet safe (AI ADP OVERRIDES
   * the real board in RecommendationEngine, and dynasty leagues fall through to redraft).
   *
   * Returning the existing "no snapshot" shape rather than a 4xx is deliberate: every caller
   * already handles it, so the flag is a true single switch instead of a new error path.
   */
  const result = isAiAdpConsumerEnabled() ? await getAiAdp(sport, leagueType, formatKey) : null
  if (!result) {
    return NextResponse.json({
      entries: [],
      totalDrafts: 0,
      totalPicks: 0,
      computedAt: null,
      stale: true,
      ageHours: null,
      message: 'No AI ADP snapshot for this segment. Run the daily AI ADP job or use standard ADP.',
    })
  }

  return NextResponse.json({
    entries: result.entries.slice(0, limit),
    totalDrafts: result.totalDrafts,
    totalPicks: result.totalPicks,
    computedAt: result.computedAt?.toISOString() ?? null,
    lowSampleThreshold: result.lowSampleThreshold,
    stale: result.stale,
    ageHours: result.ageHours,
    message: result.stale
      ? 'AI ADP snapshot is stale. Run the daily AI ADP job to refresh this segment.'
      : null,
  })
}

