/**
 * GET: the Decision OS `manager.draft.pick` decision for the signed-in manager's roster.
 *
 * Draft OS assembles the engine input from Postgres (pool, picks, ADP, roster template), the
 * decision wraps the draft recommender, and the live pick rules gate its top choice — so the
 * answer is what the room would accept right now, not only what ranks first. Read-only: it never
 * makes a pick.
 *
 * 409 with `reason` when there is no decision to make: no draft, or no roster for this user.
 *
 * An AUCTION returns `{ auction }` instead of a pick decision (2026-11-14): a price for the player
 * up for bid, value targets and a nomination, from the same engine ranking
 * (lib/shared-services/draft/auctionDecision.ts). It used to answer 409 `auction_unsupported`.
 *
 * A pick decision also carries `context`: the scoring window, any position run and the open
 * starting slots among the teams picking before the user's next turn — the specifics of THIS draft.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { buildDraftDecisionContext } from '@/lib/shared-services/draft/DraftContextAssembler'
import type { RecommendationResult } from '@/lib/draft-helper/RecommendationEngine'
import { buildAuctionDecision } from '@/lib/shared-services/draft/auctionDecision'
import { decideDraftPickForRoster } from '@/lib/shared-services/draft/pickDecision'
import { scheduleDraftRecommendationRecord } from '@/lib/shared-services/draft/recommendationRecorder'
import { loadManagersAhead } from '@/lib/competitive-edge/liveDraftManagers'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  if (!(await canAccessLeagueDraft(leagueId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [snapshot, rosterId] = await Promise.all([
    buildSessionSnapshot(leagueId),
    getCurrentUserRosterIdForLeague(leagueId, userId),
  ])
  if (!snapshot) return NextResponse.json({ error: 'No draft for this league.', reason: 'no_draft' }, { status: 409 })
  if (!rosterId) {
    return NextResponse.json({ error: 'You do not have a team in this draft.', reason: 'no_roster' }, { status: 409 })
  }
  if (snapshot.draftType === 'auction') {
    try {
      const { advice, scoringWindowInsight } = await buildAuctionDecision({ leagueId, rosterId })
      return NextResponse.json({ auction: { ...advice, scoringWindowInsight, generatedAt: new Date().toISOString() } })
    } catch {
      return NextResponse.json({ error: 'The auction could not be loaded.', reason: 'context_unavailable' }, { status: 409 })
    }
  }

  let context: Awaited<ReturnType<typeof buildDraftDecisionContext>>
  try {
    context = await buildDraftDecisionContext({ leagueId, rosterId })
  } catch {
    // League, session or roster vanished between the reads above and this one.
    return NextResponse.json({ error: 'The draft could not be loaded.', reason: 'context_unavailable' }, { status: 409 })
  }
  // Forward test of replacement value — background only, never awaited (recommendationRecorder.ts).
  scheduleDraftRecommendationRecord({
    surface: 'decision_card',
    sport: context.sport,
    leagueId,
    sessionKey: context.sessionId ?? leagueId,
    rosterKey: rosterId,
    overallPick: context.pick,
    round: context.round,
    input: context.engineInput,
  })
  // The managers on the clock before this viewer's next pick (facts; history only with Competitive
  // Edge) — read alongside the decision, and never allowed to fail it.
  const managersAheadRead = loadManagersAhead({ leagueId, userId }).catch(() => null)
  /*
   * The same sequence Chimmy uses (lib/shared-services/draft/pickDecision.ts): the recommender, gated by the live
   * pick rules — so the card and the chat cannot recommend different players.
   */
  const outcome = await decideDraftPickForRoster({ leagueId, userId, rosterId, snapshot, context })
  if (!outcome.ok) {
    return NextResponse.json({ error: 'The draft could not be loaded.', reason: outcome.reason }, { status: 409 })
  }
  const { decision } = outcome
  const engineResult: RecommendationResult | null = outcome.engineResult

  return NextResponse.json({
    decision: {
      decisionId: decision.decision_id,
      decisionType: decision.decision_type,
      lifecyclePhase: decision.lifecycle_phase,
      fourAnswers: decision.four_answers,
      recommendedActions: decision.recommended_actions,
      ruleVerdicts: decision.rule_verdicts,
      confidence: decision.confidence,
      dataCompleteness: decision.data_completeness,
      uncertaintySources: decision.uncertainty_sources,
      forOverall: snapshot.currentPick?.overall ?? null,
      generatedAt: new Date().toISOString(),
      context: {
        scoringWindow: (engineResult as RecommendationResult | null)?.scoringWindowInsight ?? null,
        run: (engineResult as RecommendationResult | null)?.runInsight ?? null,
        teamsAhead: (engineResult as RecommendationResult | null)?.teamsAheadInsight ?? null,
        managersAhead: await managersAheadRead,
      },
    },
  })
}
