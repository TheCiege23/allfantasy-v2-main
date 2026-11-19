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
    context: buildDraftDecisionContext,
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
      worldInput: { snapshot, rosterId: args.rosterId },
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
