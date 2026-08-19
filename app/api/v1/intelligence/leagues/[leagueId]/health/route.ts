import { NextRequest, NextResponse } from 'next/server'
import { createIntelligenceApiDeps } from '@/lib/intelligence/api/deps'
import { healthHandler } from '@/lib/intelligence/api/handlers'

export const dynamic = 'force-dynamic'

// GET /api/v1/intelligence/leagues/[leagueId]/health — commissioner-only
export async function GET(_req: NextRequest, ctx: { params: { leagueId: string } }) {
  const r = await healthHandler(ctx.params.leagueId, createIntelligenceApiDeps())
  return NextResponse.json(r.body, { status: r.status })
}
