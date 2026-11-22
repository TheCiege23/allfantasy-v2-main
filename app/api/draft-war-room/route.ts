import { NextResponse } from 'next/server'

/**
 * Retired 2026-11-14. This endpoint ran a second, independent draft ranker
 * (`computeDraftDecision`) that disagreed with the one every draft screen uses, and nothing in
 * the app called it. Draft advice now has a single engine — `lib/draft-helper/RecommendationEngine.ts`,
 * wrapped as the Decision OS `manager.draft.pick` decision — served by `/api/draft/recommend` and
 * `/api/leagues/[leagueId]/draft/decision`.
 *
 * 410 rather than a deleted route, so a stale client gets a clear answer instead of a 404 (the
 * same shape `retiredProfileRoute` uses).
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Draft War Room advice moved to the unified draft engine. Use POST /api/draft/recommend.',
      code: 'DRAFT_WAR_ROOM_RETIRED',
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  )
}
