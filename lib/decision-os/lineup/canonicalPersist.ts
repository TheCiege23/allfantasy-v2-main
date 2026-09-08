import 'server-only'

import { adaptLineupStartSit, type AdapterContext } from '@/lib/decision-os/canonical/adapters'
import { shadowPersistDecisions, type CanonicalDecisionStore, type ShadowPersistResult } from '@/lib/decision-os/canonical'
import type { CanonicalDecision } from '@/lib/decision-os/canonical'
import type { LineupShadowResult } from './shadow'

/**
 * Persist the lineup decisions the shadow sweep ALREADY computes (P5, step 1).
 *
 * ── 🛑 WHY THIS EXISTS: THE CANONICAL LAYER HAD NO WRITER AT ALL ─────────────────────────────
 * `canonical_decisions` has a 46-column schema, a migration, a validated persistence boundary and
 * five adapters — and, measured 2026-09-08, ZERO production callers of any of them and ZERO rows.
 * `shadowPersistDecisions`, `adaptLineupStartSit` and its four siblings appear only in their own
 * definitions, the contract doc, and tests. So the flag `DECISION_OS_CANONICAL_SHADOW_ENABLED` was
 * not "the switch that fills the table" — nothing reached the boundary for it to gate.
 *
 * ⚠ AND THE ONE MODULE THAT WANTED TO READ THAT TABLE ALREADY ROUTED AROUND IT.
 * `grounding/decisionBridge.ts` says so in its own header: "There are no decision objects to read…
 * A bridge reading that table would return nothing, for every league, silently — the
 * `ingestCFBDStats` failure this codebase has already paid for once." It runs the engines inline
 * instead. That was correct, and it stays correct until this table has rows worth reading.
 *
 * ── WHY THE SWEEP AND NOT THE REQUEST PATH ──────────────────────────────────────────────────
 * `runLineupShadow` is called from BOTH `/api/today/lineup-actions` (a user request) and the
 * 10-minute maintenance sweep. Persisting on the request path would add a write to a page load for
 * a table nothing reads yet — cost with no reader. The sweep already runs this exact engine across
 * rotating leagues and throws the decision away; 11,054 parity rows are the proof it runs. Writing
 * down what it has already computed is the cheapest possible writer.
 *
 * ⚠ WHICH ALSO MAKES THIS THE SCHEDULED WRITER THE CLAUDE.md RULE DEMANDS. "The scheduled writer is
 * the part that is easy to skip and fatal to skip" — a surface pointed at a table nothing refreshes
 * fails silently and looks correct. This is that writer, landing BEFORE any reader.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────────
 * 🛑 IT DOES NOT SERVE ANYTHING, AND CANNOT. `shadowPersistDecisions` refuses any mode but
 * `'shadow'` by construction, and this passes `'shadow'` literally. Nothing here reads for the UI,
 * for Chimmy, or for notifications. Restoring `start_sit → lineupDecision` to the grounding packet
 * on the back of these rows is a SEPARATE, later change — and the one that has to migrate a read
 * and a writer together.
 *
 * ⚠ AND IT IS DOUBLY INERT TODAY: the sweep only runs when `DECISION_OS_SHADOW_SWEEP_ENABLED` is
 * true, and the persist is refused unless `DECISION_OS_CANONICAL_SHADOW_ENABLED` is true. Neither
 * is set in production at the time of writing, so landing this changes nothing until an operator
 * flips a switch — deliberately, so the wiring can be reviewed against real rows before it counts.
 */

/** What the caller must supply that the shadow result cannot carry. */
export interface LineupCanonicalPersistArgs {
  userId: string
  results: LineupShadowResult[]
  /**
   * One id for the whole sweep tick.
   *
   * ⚠ REQUIRED, NOT OPTIONAL, AND THE CONTRACT ENFORCES IT: shadow persistence REJECTS a decision
   * with a null `runId`, because `canonical_decision_revisions` keys an occurrence on
   * (decisionId, runId). A per-decision id would make every write its own "run" and defeat the
   * same-run conflict detection the revision table exists for.
   */
  runId: string
  store: CanonicalDecisionStore
  now?: Date
  env?: NodeJS.ProcessEnv
}

/**
 * Map one ran shadow result onto the canonical adapter's input.
 *
 * ⚠ THE FOUR ANSWERS MAP ONTO THREE FIELDS, AND `how_confident` IS DELIBERATELY DROPPED. It is a
 * rendering of `confidence` ("Medium confidence (data partial…)"), and `confidencePct` already
 * carries the number. Storing the prose too would put the same fact in two columns that can drift.
 */
function toAdapterInput(r: LineupShadowResult) {
  const decision = r.result!.decision
  const four = decision.four_answers
  return {
    id: decision.decision_id,
    // 'manager_lineup_missing' is the adapter's OTHER category and is deliberately not inferred
    // here: the shadow's summary does not distinguish "no lineup set" from "a lineup that could be
    // better", and guessing would put a high-severity/today-urgency row on an ordinary call.
    category: 'start_sit' as const,
    title: four.what_happened,
    explanation: decision.explanation,
    recommendedAction: four.what_to_do,
    confidencePct: typeof decision.confidence === 'number' ? decision.confidence : null,
    // Players are NOT lifted from `recommended_actions`. `DecisionPlayerRef` needs an id space this
    // module cannot verify, and a wrong ref here would attribute one player's call to another —
    // the same id-space defect already measured on the trade shadow this week. Absent scope
    // degrades to 'league', which is honest.
    subjectKey: r.leagueId,
  }
}

/**
 * Adapt and persist. NEVER THROWS — a telemetry-adjacent writer must not be able to fail a cron
 * that also does real work, and the boundary itself already swallows nothing, so the guard lives
 * here.
 */
export async function persistLineupCanonicalDecisions(
  args: LineupCanonicalPersistArgs,
): Promise<ShadowPersistResult | { mode: 'shadow'; enabled: false; attempted: 0; persisted: 0; error: string }> {
  try {
    const ran = args.results.filter((r) => r?.ran && r.result?.decision)
    if (ran.length === 0) {
      return { mode: 'shadow', enabled: false, attempted: 0, persisted: 0, error: 'no_ran_results' }
    }

    const now = args.now ?? new Date()
    const decisions: CanonicalDecision[] = ran.map((r) => {
      const world = r.result!.world as { sport?: string; week?: number; season?: number } | undefined
      const ctx: AdapterContext = {
        userId: args.userId,
        leagueId: r.leagueId,
        sport: world?.sport ?? 'NFL',
        season: typeof world?.season === 'number' ? world.season : null,
        // `week:N` is the contract's own example format. Null when the world could not resolve a
        // week — a period that says 'week:undefined' would be worse than one that says nothing.
        period: typeof world?.week === 'number' ? `week:${world.week}` : null,
        // ⚠ PROVENANCE, NOT PLATFORM. `r.source` is 'redraft_native' | 'canonical_world_*' — where
        // the INPUTS came from, which the shadow's own comment calls provenance-only and explicitly
        // NOT a decision input. It is not a fantasy platform, so it must not be reported as one.
        sourcePlatform: null,
        generatedAt: now.toISOString(),
        runId: args.runId,
      }
      return adaptLineupStartSit(toAdapterInput(r), ctx)
    })

    return await shadowPersistDecisions({
      decisions,
      // Literal, not a parameter. A caller must not be able to ask this path for 'live'.
      mode: 'shadow',
      store: args.store,
      env: args.env,
      now,
    })
  } catch (e) {
    return {
      mode: 'shadow',
      enabled: false,
      attempted: args.results.length,
      persisted: 0,
      error: e instanceof Error ? e.message.slice(0, 120) : 'persist_failed',
    }
  }
}
