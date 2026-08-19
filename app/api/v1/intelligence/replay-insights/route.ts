import { NextRequest, NextResponse } from 'next/server'
import {
  replayInsightHandler,
  createLiveReplayInsightDataProvider,
} from '@/lib/decision-os/replay-insights/replayInsightResolver'

export const dynamic = 'force-dynamic'

// GET /api/v1/intelligence/replay-insights?leagueId={id}
// Required scope: intelligence:league:read (commissioner + platform tiers).
// Gated by DECISION_OS_INTELLIGENCE_API_ENABLED=true + X-AllFantasy-API-Key header.
//
// Thin adapter only (Phase 19): all auth/tenant/scope/param/leak-safety logic
// lives in `replayInsightHandler`. The live provider performs only the read-only
// Phase 15/16 Decision Replay Correlation queries (two findMany, zero writes).
// No UI, no Chimmy, no recommendation logic, no database writes.
export async function GET(req: NextRequest) {
  const ctx = {
    headers:      req.headers,
    searchParams: new URL(req.url).searchParams,
  }
  const r = await replayInsightHandler(ctx, createLiveReplayInsightDataProvider())
  return NextResponse.json(r.body, { status: r.status })
}
