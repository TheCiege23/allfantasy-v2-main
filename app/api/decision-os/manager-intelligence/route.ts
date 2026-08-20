import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveManagerIntelligencePayload } from '@/lib/decision-os/dashboard-intelligence'
import { authorizeLeagueRead } from '@/lib/decision-os/leagueReadAuthorization'
import { readLeagueIntelligence } from '@/lib/decision-os/three-brain/phase3/readLeagueIntelligence'
import { generateLeagueIntelligence } from '@/lib/decision-os/three-brain/phase3/generateLeagueIntelligence'

export const dynamic = 'force-dynamic'

/**
 * Decision OS — Phase 8.1 real Manager DNA + Recommendations for the signed-in
 * user in one league. Read-only. Degraded-safe: `resolveManagerIntelligencePayload`
 * never throws — a pipeline failure returns honest nulls, not a 500.
 *
 * Phase OS-C6.1: gated by `authorizeLeagueRead`. The returned payload is already scoped to the
 * caller's own `managerId` (so an unrelated caller could never see another manager's DNA/
 * recommendations even before this gate), but `leagueTrend` is real, league-wide activity data
 * computed regardless of caller identity — closing this gap prevents that one field from leaking to a
 * non-member.
 */
export async function GET(request: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = new URL(request.url).searchParams.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const gate = await authorizeLeagueRead(leagueId, userId)
  if (!gate.authorized) {
    return NextResponse.json(
      { error: gate.status === 403 ? 'Forbidden' : 'Unauthorized' },
      { status: gate.status },
    )
  }

  const payload = await resolveManagerIntelligencePayload({ leagueId, managerId: userId })

  // Phase 3 — attach the three-brain analysis ALONGSIDE the deterministic payload, never in place
  // of it. The deterministic half is what this endpoint has always returned and stays the contract;
  // `intelligence` is additive, so a client that ignores it is unaffected.
  //
  // This read is DB-first and side-effect-free: it returns a persisted run or an honest status, and
  // never triggers generation. See `readLeagueIntelligence` for why a GET must not be the thing
  // that spends provider tokens. It also cannot throw — every failure is a typed status — so it
  // preserves this route's degraded-safe contract of honest nulls over a 500.
  const intelligence = await readLeagueIntelligence({
    leagueId,
    userId,
    tool: 'manager_intelligence',
    decisionType: 'manager_intelligence',
  })

  return NextResponse.json({ ...payload, intelligence })
}

/**
 * POST — generate the analysis the GET above only reads.
 *
 * This exists because the pipeline had no way to produce its FIRST run. Generation happens inside
 * `runManagedIntelligence` when it wins the single-flight claim; the GET deliberately never calls it
 * (a page view must not cost three provider calls), and the maintenance cron only DRAINS refresh jobs,
 * which are enqueued solely for a run that already exists and went stale (`intelligenceService`
 * `enqueueStaleRefresh`, reachable only from the `stale && existing` branch). With zero runs there was
 * nothing to refresh, so maintenance no-opped forever and no analysis could ever come into being.
 *
 * It is a POST on the EXISTING path rather than a new route: this repo sits at Vercel's 2048-route
 * ceiling and additional methods on one route file cost no route budget.
 *
 * Why user-initiated rather than seeded by the cron: `INTELLIGENCE_FEATURE_MAP` gives these tools
 * `allowTokenFallback: true`, so for a user without the plan a run SPENDS THAT USER'S TOKENS. Seeding
 * on a schedule would spend a user's balance on an analysis they never asked for. A POST is the user
 * asking. Concurrent presses are safe — the single-flight claim coalesces them onto one run rather
 * than issuing duplicate provider requests.
 */
export async function POST(request: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { leagueId?: string } | null
  const leagueId = body?.leagueId?.trim() || new URL(request.url).searchParams.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const gate = await authorizeLeagueRead(leagueId, userId)
  if (!gate.authorized) {
    return NextResponse.json(
      { error: gate.status === 403 ? 'Forbidden' : 'Unauthorized' },
      { status: gate.status },
    )
  }

  const outcome = await generateLeagueIntelligence({
    leagueId,
    userId,
    tool: 'manager_intelligence',
    decisionType: 'manager_intelligence',
  })

  // An entitlement/token denial is a real answer, not a server fault — 402 so the client can offer the
  // upgrade or token path instead of rendering a generic failure.
  if (outcome.status === 'denied') {
    return NextResponse.json(outcome, { status: 402 })
  }
  return NextResponse.json(outcome)
}
