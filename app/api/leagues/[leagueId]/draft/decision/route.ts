/**
 * GET: the Decision OS `manager.draft.pick` decision for the signed-in manager's roster.
 *
 * Draft OS assembles the engine input from Postgres (pool, picks, ADP, roster template), the
 * decision wraps the draft recommender, and the live pick rules gate its top choice — so the
 * answer is what the room would accept right now, not only what ranks first. Read-only: it never
 * makes a pick.
 *
 * 409 with `reason` when there is no decision to make: no draft, no roster for this user, or an
 * auction (nominations and bids are not a single pick, and this decision does not model them).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { validateRosterFitForDraftPick } from '@/lib/live-draft-engine/RosterFitValidation'
import { buildDraftDecisionContext } from '@/lib/shared-services/draft/DraftContextAssembler'
import { computeDraftRecommendation } from '@/lib/draft-helper/RecommendationEngine'
import { runDraftPickDecision } from '@/lib/decision-os/draft'

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
    return NextResponse.json(
      { error: 'Draft decisions do not cover auctions yet.', reason: 'auction_unsupported' },
      { status: 409 },
    )
  }

  let context: Awaited<ReturnType<typeof buildDraftDecisionContext>>
  try {
    context = await buildDraftDecisionContext({ leagueId, rosterId })
  } catch {
    // League, session or roster vanished between the reads above and this one.
    return NextResponse.json({ error: 'The draft could not be loaded.', reason: 'context_unavailable' }, { status: 409 })
  }
  const existingPicks = snapshot.picks.map((p) => ({ rosterId: p.rosterId, position: p.position }))
  const { decision } = await runDraftPickDecision(
    {
      worldInput: { snapshot, rosterId },
      userId,
      leagueId,
      sport: context.sport,
      engineInput: context.engineInput,
      coverage: context.dataCompleteness,
    },
    {
      recommend: computeDraftRecommendation,
      ruleDeps: {
        validateRosterFit: (candidate) =>
          validateRosterFitForDraftPick({ leagueId, rosterId, existingPicks, newPickPosition: candidate.position }),
      },
    },
  )

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
    },
  })
}
