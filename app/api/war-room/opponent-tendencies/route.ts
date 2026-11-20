import { NextRequest, NextResponse } from 'next/server'
import type { LeagueSport } from '@prisma/client'
import { requireUserId, requireLeagueWarRoom } from '@/lib/war-room/war-room-api'
import { logAiRecommendation, upsertManagerTendency } from '@/lib/war-room/war-room-persist'

export const dynamic = 'force-dynamic'

/**
 * POST /api/war-room/opponent-tendencies — store inferred manager draft tendencies for intel panel.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : undefined
  const gate = await requireLeagueWarRoom(leagueId, auth.userId, 'tendency')
  if (!gate.ok) return gate.response

  const rosterId = typeof body.rosterId === 'string' ? body.rosterId : ''
  const season = typeof body.season === 'number' ? body.season : undefined
  if (!rosterId || season === undefined) {
    return NextResponse.json({ error: 'rosterId and season are required' }, { status: 400 })
  }

  const tendenciesJson =
    body.tendencies && typeof body.tendencies === 'object' ? body.tendencies : { note: 'client_computed' }

  const row = await upsertManagerTendency({
    leagueId: gate.ctx.leagueId,
    season,
    rosterId,
    sport: gate.ctx.sport as unknown as LeagueSport,
    label: typeof body.label === 'string' ? body.label : null,
    tendenciesJson,
    samplePicks: typeof body.samplePicks === 'number' ? body.samplePicks : undefined,
  })

  const log = await logAiRecommendation({
    userId: auth.userId,
    leagueId: gate.ctx.leagueId,
    feature: 'war_room_opponent_tendencies',
    inputJson: body as object,
    outputJson: { tendencyId: row.id } as object,
  })

  return NextResponse.json({
    ok: true,
    tendencyId: row.id,
    updatedAt: row.updatedAt.toISOString(),
    logId: log.id,
  })
}

// GET (a per-manager read of the personality profiles) was removed 2026-11-19 with those profiles — re-score
// build item 10. Nothing in the app called it; how leaguemates draft is in the draft room's managers-before-
// your-pick facts.
