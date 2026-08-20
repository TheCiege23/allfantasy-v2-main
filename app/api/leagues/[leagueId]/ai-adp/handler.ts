/**
 * GET: AI ADP for this league's context (sport, leagueType, format).
 * When league has AI ADP enabled (draft_ai_adp_enabled), returns snapshot entries for player list ordering.
 * Response includes enabled, entries, totalDrafts, computedAt, lowSampleThreshold; entries have lowSample flag.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { getAiAdpForLeague } from '@/lib/ai-adp-engine'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { prisma } from '@/lib/prisma'
import { resolveAiAdpFormatKeyFromSettings } from '@/lib/ai-adp-engine/segment-resolver'
import { readAllFantasyAdpForLeague } from '@/lib/adp/readSnapshotForLeague'
import type { DraftMode } from '@/lib/adp/computeAllFantasyAdp'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId } = await ctx.params
  if (!leagueId) {
    return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  }

  const allowed = await canAccessLeagueDraft(leagueId, (session?.user as any).id)
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, isDynasty: true, settings: true },
  })
  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  const uiSettings = await getDraftUISettingsForLeague(leagueId)
  const enabled = uiSettings.aiAdpEnabled
  const sport = String(league.sport ?? 'NFL')
  const isDynasty = !!league.isDynasty
  const settings = (league.settings as Record<string, unknown>) ?? {}
  const formatKey = resolveAiAdpFormatKeyFromSettings(settings)

  /**
   * D.5-test — optional new-table source. Pass `?source=allfantasy` to read from
   * the AllFantasyAdpSnapshot pipeline (fed by scripts/recompute-allfantasy-adp.ts).
   * Pass `?draftMode=test` to surface seeded harness data for validation.
   *
   * Default behavior is unchanged: the legacy `getAiAdpForLeague` path runs and
   * the production AI ADP keeps flowing exactly as before.
   */
  const sourceParam = req.nextUrl.searchParams?.get('source')?.toLowerCase()
  const draftModeParam = req.nextUrl.searchParams?.get('draftMode')?.toLowerCase() as DraftMode | undefined
  if (sourceParam === 'allfantasy') {
    const draftMode: DraftMode =
      draftModeParam === 'test' || draftModeParam === 'mock' ? draftModeParam : 'real'
    const af = await readAllFantasyAdpForLeague(leagueId, { draftMode })
    return NextResponse.json({
      enabled,
      source: 'allfantasy',
      draftMode,
      contextHash: af.contextHash,
      entries: af.entries.map((e) => ({
        playerName: e.playerName,
        position: e.position,
        team: e.team,
        adp: e.adp,
        sampleSize: e.sampleSize,
        lowSample: e.lowSample,
        sevenDayTrend: e.sevenDayTrend,
        thirtyDayTrend: e.thirtyDayTrend,
      })),
      totalDrafts: af.totalDrafts,
      totalPicks: 0,
      computedAt: af.computedAt?.toISOString() ?? null,
      segment: null,
      lowSampleThreshold: 10,
      stale: af.computedAt == null,
      ageHours: af.computedAt
        ? Math.round((Date.now() - af.computedAt.getTime()) / (60 * 60 * 1000))
        : null,
      message:
        af.entries.length === 0
          ? 'No AllFantasy AI ADP snapshot for this context yet. Run `npm run recompute:allfantasy-adp -- --apply` after seeding/collecting drafts.'
          : null,
    })
  }

  const result = await getAiAdpForLeague(sport, isDynasty, formatKey)
  if (!result) {
    return NextResponse.json({
      enabled,
      entries: [],
      totalDrafts: 0,
      totalPicks: 0,
      computedAt: null,
      segment: null,
      stale: true,
      ageHours: null,
      message: enabled
        ? 'AI ADP is enabled but no snapshot for this segment yet. Run the daily AI ADP job or use standard ADP until then.'
        : null,
    })
  }

  const limit = Math.min(parseInt(req.nextUrl.searchParams?.get('limit') ?? '300', 10), 500)
  return NextResponse.json({
    enabled,
    entries: result.entries.slice(0, limit),
    totalDrafts: result.totalDrafts,
    totalPicks: result.totalPicks,
    computedAt: result.computedAt?.toISOString() ?? null,
    segment: result.segment,
    lowSampleThreshold: result.lowSampleThreshold,
    stale: result.stale,
    ageHours: result.ageHours,
    message: result.stale
      ? 'AI ADP snapshot is stale. Order still uses latest available AI ADP and refreshes after the next daily job.'
      : null,
  })
}
