import { NextRequest, NextResponse } from 'next/server'
import { createIntelligenceApiDeps } from '@/lib/intelligence/api/deps'
import { managerHandler } from '@/lib/intelligence/api/handlers'

export const dynamic = 'force-dynamic'

// GET /api/v1/intelligence/leagues/[leagueId]/managers/[managerId]
// Self-readable (own snapshot) or commissioner (any manager).
export async function GET(_req: NextRequest, ctx: { params: { leagueId: string; managerId: string } }) {
  const r = await managerHandler(ctx.params.leagueId, ctx.params.managerId, createIntelligenceApiDeps())
  return NextResponse.json(r.body, { status: r.status })
}
