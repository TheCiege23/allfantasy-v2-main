import 'server-only'

import type { Decision } from '@/lib/decision-os/core/decision'
import type { DraftPickRecommendation } from '@/lib/decision-os/draft'
import type { RecommendationInput, RecommendationResult } from '@/lib/draft-helper/RecommendationEngine'
import type { DraftDecisionContext } from './DraftContextAssembler'

/**
 * THE DRAFT PICK DECISION FOR ONE ROSTER — one sequence for every surface that says "take X" (2026-11-16 re-score
 * item 7).
 *
 * 🛑 CHIMMY COULD SAY "TAKE X" WHILE THE DRAFT CARD SAID "SKIP X". The card (`/api/leagues/[id]/draft/decision`)
 * runs the recommender through `runDraftPickDecision`, which gates the top choice through the live pick rules —
 * roster fit, the clock, a completed roster — and turns it into "Draft X", "Queue X" or "Skip X; consider Y".
 * Chimmy called the recommender directly and read its top choice, so a player the room would refuse (no open slot
 * at his position) was still Chimmy's pick. Both now call this.
 *
 * Read-only: it never makes a pick.
 */

export type PickDecisionResult =
  | {
      ok: true
      decision: Decision<DraftPickRecommendation>
      /** The recommender's full result, for the draft-context lines (scoring window, runs, teams ahead). */
      engineResult: RecommendationResult | null
      context: DraftDecisionContext
      /** The pick this is for. */
      forOverall: number | null
    }
  | { ok: false; reason: 'no_draft' | 'context_unavailable' }

type Snapshot = NonNullable<Awaited<ReturnType<typeof import('@/lib/live-draft-engine/DraftSessionService').buildSessionSnapshot>>>

export type PickDecisionDeps = {
  snapshot: (leagueId: string) => Promise<Snapshot | null>
  context: (input: { leagueId: string; rosterId: string }) => Promise<DraftDecisionContext>
  recommend: (input: RecommendationInput) => RecommendationResult
  validateRosterFit: (input: {
    leagueId: string
    rosterId: string
    existingPicks: Array<{ rosterId: string; position: string }>
    newPickPosition: string
  }) => Promise<{ valid: boolean; error?: string }>
}

async function defaultDeps(): Promise<PickDecisionDeps> {
  const [{ buildSessionSnapshot }, { buildDraftDecisionContext }, { computeDraftRecommendation }, { validateRosterFitForDraftPick }] =
    await Promise.all([
      import('@/lib/live-draft-engine/DraftSessionService'),
      import('./DraftContextAssembler'),
      import('@/lib/draft-helper/RecommendationEngine'),
      import('@/lib/live-draft-engine/RosterFitValidation'),
    ])
  return {
    snapshot: buildSessionSnapshot as PickDecisionDeps['snapshot'],
    // The decision plans for the roster's own next turn when it is off the clock (planForOwnPick.ts).
    context: (input) => buildDraftDecisionContext({ ...input, planForOwnTurn: true }),
    recommend: computeDraftRecommendation,
    validateRosterFit: validateRosterFitForDraftPick as PickDecisionDeps['validateRosterFit'],
  }
}

export async function decideDraftPickForRoster(
  args: {
    leagueId: string
    userId: string
    rosterId: string
    /** Already read by the caller; read here when absent. */
    snapshot?: Snapshot | null
    /** Already assembled by the caller (the route records it); assembled here when absent. */
    context?: DraftDecisionContext
  },
  deps: Partial<PickDecisionDeps> = {},
): Promise<PickDecisionResult> {
  const d: PickDecisionDeps = { ...(await defaultDeps()), ...deps }
  const snapshot = args.snapshot !== undefined ? args.snapshot : await d.snapshot(args.leagueId).catch(() => null)
  if (!snapshot) return { ok: false, reason: 'no_draft' }

  let context: DraftDecisionContext
  try {
    context = args.context ?? (await d.context({ leagueId: args.leagueId, rosterId: args.rosterId }))
  } catch {
    return { ok: false, reason: 'context_unavailable' }
  }

  const existingPicks = snapshot.picks.map((p) => ({ rosterId: p.rosterId, position: p.position }))
  let engineResult: RecommendationResult | null = null
  const { runDraftPickDecision } = await import('@/lib/decision-os/draft')
  const { decision } = await runDraftPickDecision(
    {
      worldInput: {
        snapshot,
        rosterId: args.rosterId,
        picksUntilTurn: context.plannedFor?.picksAway ?? null,
        plannedOverall: context.plannedFor?.overall ?? null,
      },
      userId: args.userId,
      leagueId: args.leagueId,
      sport: context.sport,
      engineInput: context.engineInput,
      coverage: context.dataCompleteness,
    },
    {
      recommend: (input) => (engineResult = d.recommend(input)),
      ruleDeps: {
        validateRosterFit: (candidate) =>
          d.validateRosterFit({ leagueId: args.leagueId, rosterId: args.rosterId, existingPicks, newPickPosition: candidate.position }),
      },
    },
  )
  return { ok: true, decision, engineResult, context, forOverall: snapshot.currentPick?.overall ?? null }
}

/**
 * ONE ENGINE IN THE DRAFT ROOM (re-score build item 8, 2026-11-19).
 *
 * 🛑 THE ROOM SHOWED THREE ANSWERS TO "WHO DO I TAKE". The Decision OS card ranked the server's pool with this
 * draft's context (scoring window, byes, runs, teams ahead, projections, the live pick rules). The copilot
 * (`/api/draft/recommend`) and the War Room (`/api/ai/draft/recommend`) ran the same engine on the pool the
 * BROWSER sent, without that context and without the rules — so the three could name three players. Both now
 * take this result when they can build it, so the room has one answer, and their prose explains that answer.
 *
 * The result is the engine's own, made consistent with the decision: when the decision skips its top choice
 * (an `illegal` verdict — already taken, or no roster spot — other than "the draft is over"), the player the card
 * names after "consider" leads, exactly as the card says.
 *
 * Null when there is no decision to share (no draft, no roster for this user, an auction, or the context could
 * not be read): the caller then keeps its own computation, so nothing that worked before stops working.
 */
export function engineResultForDecision(outcome: Extract<PickDecisionResult, { ok: true }>): RecommendationResult | null {
  const result = outcome.engineResult
  if (!result?.recommendation) return result
  const skipped = outcome.decision.rule_verdicts.some((v) => v.verdict === 'illegal' && v.rule !== 'draft.legality.complete')
  if (!skipped) return result
  const [next, ...rest] = result.alternatives
  if (!next) return { ...result, recommendation: null, alternatives: [] }
  return {
    ...result,
    // The engine's figures belong to the player it ranked first; the one promoted carries none of its own.
    recommendation: { player: next.player, reason: next.reason, confidence: next.confidence, needScore: 0, adpEdge: 0, adpIsReal: false },
    alternatives: rest,
    reachWarning: null,
    valueWarning: null,
  }
}

/**
 * The room's one pick for this user in this league, or null (see `engineResultForDecision`). Never throws: a
 * caller that cannot get it keeps its own answer.
 */
export async function sharedDraftPickForUser(
  args: { leagueId: string; userId: string },
  deps: Partial<PickDecisionDeps> & { rosterIdFor?: (leagueId: string, userId: string) => Promise<string | null> } = {},
): Promise<{ result: RecommendationResult; plannedFor: DraftDecisionContext['plannedFor'] } | null> {
  try {
    const rosterIdFor =
      deps.rosterIdFor ?? (await import('@/lib/live-draft-engine/auth')).getCurrentUserRosterIdForLeague
    const rosterId = await rosterIdFor(args.leagueId, args.userId)
    if (!rosterId) return null
    const d: PickDecisionDeps = { ...(await defaultDeps()), ...deps }
    const snapshot = await d.snapshot(args.leagueId).catch(() => null)
    if (!snapshot || snapshot.draftType === 'auction') return null
    const outcome = await decideDraftPickForRoster({ leagueId: args.leagueId, userId: args.userId, rosterId, snapshot }, d)
    if (!outcome.ok) return null
    const result = engineResultForDecision(outcome)
    return result ? { result, plannedFor: outcome.context.plannedFor ?? null } : null
  } catch {
    return null
  }
}
