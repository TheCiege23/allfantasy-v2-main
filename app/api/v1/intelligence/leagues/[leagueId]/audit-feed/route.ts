import { NextRequest, NextResponse } from 'next/server'
import { createIntelligenceApiDeps } from '@/lib/intelligence/api/deps'
import { auditFeedHandler, parseAuditFeedQuery } from '@/lib/intelligence/api/handlers'

export const dynamic = 'force-dynamic'

// GET /api/v1/intelligence/leagues/[leagueId]/audit-feed?limit&cursor — manager-readable
export async function GET(req: NextRequest, ctx: { params: { leagueId: string } }) {
  const query = parseAuditFeedQuery(req.nextUrl.searchParams)
  const r = await auditFeedHandler(ctx.params.leagueId, createIntelligenceApiDeps(), query)
  return NextResponse.json(r.body, { status: r.status })
}
