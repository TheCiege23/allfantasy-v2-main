import { NextRequest, NextResponse } from 'next/server'
import { leagueManagerDnaIntelligenceHandler } from '@/lib/decision-os/behavioral/api/intelligence-handlers'

export const dynamic = 'force-dynamic'

// GET /api/v1/intelligence/league/manager-dna?leagueId={id}
// Required scope: intelligence:league:read (commissioner + platform tiers) — a manager-tier key
// holds intelligence:manager:read and is refused, which is the boundary a directory of other
// managers' behavioral profiles needs.
// Gated by DECISION_OS_INTELLIGENCE_API_ENABLED=true + X-AllFantasy-API-Key header.
// Takes no IntelligenceDataProvider: the DNA directory is its own composition (Phase 5.1/5.2 ->
// 6.1/6.2), the same reason /league/trend and /league/deadlines bypass it.
export async function GET(req: NextRequest) {
  const ctx = {
    headers:      req.headers,
    searchParams: new URL(req.url).searchParams,
  }
  const r = await leagueManagerDnaIntelligenceHandler(ctx)
  return NextResponse.json(r.body, { status: r.status })
}
