import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { prisma } from '@/lib/prisma'
import { buildMatchupCenterPayload } from '@/server/services/matchupCenterService'
import { runLeagueMatchupAiEngine } from '@/lib/ai-matchup-engine/runLeagueMatchupAiEngine'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { buildLeagueScoringContextForAi } from '@/lib/scoring-defaults/LeagueScoringConfigResolver'
import { AI_USAGE } from '@/lib/analytics/eventNames'
import { recordProductEvent } from '@/lib/analytics/recordAnalyticsEvent'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function leagueScoringHint(leagueId: string): Promise<string | null> {
  const detailed = await buildLeagueScoringContextForAi(leagueId)
  if (detailed) return detailed
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { scoring: true, settings: true, sport: true },
  })
  if (!league) return null
  const parts: string[] = []
  if (league.scoring) parts.push(`Scoring profile: ${league.scoring}`)
  const sport = normalizeToSupportedSport(String(league.sport))
  if (sport) parts.push(`Sport: ${sport}`)
  const s = league.settings
  if (s && typeof s === 'object' && !Array.isArray(s)) {
    const o = s as Record<string, unknown>
    if (typeof o.scoringType === 'string') parts.push(`Scoring type: ${o.scoringType}`)
    if (typeof o.scoringFormat === 'string') parts.push(`Format: ${o.scoringFormat}`)
  }
  return parts.length ? parts.join(' · ') : null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Plan gate before any rate-limit spend or AI call: `pro_matchup_analysis` (lib/monetization/entitlements.ts).
  const gate = await requireFeatureEntitlement({ userId: session.user.id, userEmail: (session?.user as { email?: string | null } | undefined)?.email ?? null, featureId: 'pro_matchup_analysis' })
  if (!gate.ok) return gate.response

  const { leagueId } = await params
  let season: number | undefined
  let week: number | undefined
  try {
    const body = (await req.json()) as { season?: number; week?: number }
    if (body.season != null && Number.isFinite(Number(body.season))) season = Number(body.season)
    if (body.week != null && Number.isFinite(Number(body.week))) week = Number(body.week)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const payload = await buildMatchupCenterPayload({
    leagueId,
    viewerUserId: session.user.id,
    season,
    week,
  })

  if ('error' in payload) {
    return NextResponse.json({ error: payload.error }, { status: payload.status })
  }

  const hint = await leagueScoringHint(leagueId)
  const analysis = await runLeagueMatchupAiEngine({ payload, leagueScoringHint: hint })

  recordProductEvent(AI_USAGE.MATCHUP_ANALYSIS, {
    userId: session.user.id,
    meta: { leagueId, season: payload.season, week: payload.week },
  })

  return NextResponse.json({ analysis, leagueId, season: payload.season, week: payload.week })
}
