import 'server-only'

import { readLeagueIntelligence } from '../three-brain/phase3/readLeagueIntelligence'
import type { IntelligenceTool } from '../three-brain/phase2/types'

/**
 * Three-brain's SAVED conclusions, for the grounding packet (6.2).
 *
 * ── 🛑 WHY THIS READS RATHER THAN RUNS, AND IT IS NOT A COMPROMISE ──────────────────────────
 * "three-brain as Chimmy's reasoning layer" reads like *call the orchestrator on a chat turn*.
 * Measured, that is a category error rather than a tuning problem:
 *
 *   runThreeBrainAnalysis  DeepSeek ∥ Grok → OpenAI synthesis → optional Claude review
 *   DEFAULT_TIMEOUT_MS     25_000, PER PROVIDER
 *   worst case             ~75s of provider time, three vendors, three failure modes
 *   the chat budget        3_000ms, the ceiling added in 48c989d6a
 *
 * A flag over that would be a switch nobody could ever turn on. Meanwhile the analyses are
 * already **persisted** — `decisionIntelligenceRun`, per user and league, with a `succeeded`
 * status — and `readLeagueIntelligence` is entitlement-checked and documented never to throw.
 *
 * So Chimmy reads the conclusion three-brain already reached. One indexed read, no provider call,
 * no added latency, and P3 holds by construction: nothing here generates a fact, it surfaces one
 * that deterministic code already produced and stored.
 *
 * ⚠ AND THE STATUSES MAP ONTO THE GAP TAXONOMY THAT ALREADY EXISTS.
 * `locked` is a permission gap — the second real producer of `not_entitled`, which until now only
 * commissioner intelligence could raise. `evidence_unavailable` is `not_computed`. Collapsing
 * them into "no analysis" would be exactly the reason-losing this packet was built to stop.
 */

export type SavedAnalysisOutcome =
  | { status: 'ok'; text: string; generatedAt: string | null; stale: boolean }
  /** A run exists but this user may not see it. */
  | { status: 'not_entitled' }
  /** No succeeded run for this league yet, or the read could not resolve one. */
  | { status: 'not_computed'; reason: string | null }

/**
 * Render the stored result as prose a prompt can use.
 *
 * ⚠ BOUNDED, AND CAVEATS ARE NEVER THE PART THAT GETS TRIMMED. A three-brain result carries
 * `caveats` precisely because its answer has limits; dropping them to save characters would ship
 * the confidence without the hedge.
 */
function render(r: {
  shortAnswer: string
  whatDataSays: string
  whatItMeans: string
  recommendedAction?: string
  caveats: string[]
  agreementState: string
}): string {
  const lines = [
    `Answer: ${r.shortAnswer}`,
    `What the data says: ${r.whatDataSays}`,
    `What it means: ${r.whatItMeans}`,
  ]
  if (r.recommendedAction) lines.push(`Recommended: ${r.recommendedAction}`)
  if (r.caveats.length) lines.push(`Caveats: ${r.caveats.join(' ')}`)
  // The models' agreement state is a confidence signal a reader should see, not internal noise.
  lines.push(`Model agreement: ${r.agreementState}`)
  return lines.join('\n')
}

export async function loadSavedThreeBrainAnalysis(input: {
  leagueId: string
  userId: string
  tool: IntelligenceTool
  decisionType: string
}): Promise<SavedAnalysisOutcome> {
  const read = await readLeagueIntelligence({
    leagueId: input.leagueId,
    userId: input.userId,
    tool: input.tool,
    decisionType: input.decisionType,
  })

  if (read.status === 'locked') return { status: 'not_entitled' }

  /*
   * ⚠ `result` IS DOCUMENTED AS POPULATED ONLY FOR `ready` / `stale` — "null in every other state,
   * never a placeholder". Both are checked rather than trusting the status alone, because a null
   * here would otherwise render as the string "undefined" inside a prompt.
   */
  if ((read.status === 'ready' || read.status === 'stale') && read.result) {
    return {
      status: 'ok',
      text: render(read.result),
      generatedAt: read.generatedAt,
      // Carried, not hidden: a stale conclusion is still worth having as long as it says so.
      stale: read.status === 'stale',
    }
  }

  return { status: 'not_computed', reason: read.reason }
}
