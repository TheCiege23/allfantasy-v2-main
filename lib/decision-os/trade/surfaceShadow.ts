/**
 * Decision OS — per-surface trade shadow instrumentation.
 * AF_TRADE_UNIFICATION_BRIEF Phase 2: every live trade-evaluation surface reports
 * BESIDE the canonical `manager.trade.evaluate` path.
 *
 * Honest-instrumentation design: the canonical evaluation
 * (`runTradeEvaluateDecision`) requires league scope, BOTH roster identities and a
 * persisted deterministic snapshot (wrap-fidelity). The non-proposal surfaces
 * (Trade Value Console, dynasty analyzer, keeper analyzer, draft-pick builder) do
 * not have all of those inputs today. Rather than fake an evaluation, each surface
 * emits a STRUCTURED shadow event that:
 *   1. names exactly which canonical inputs are missing (the convergence roadmap —
 *      telemetry tells us what world-assembly each surface still needs), and
 *   2. carries the surface's OWN deterministic verdict fields, building the sample
 *      stream that gates the Phase 3 per-surface flips.
 *
 * When a caller CAN supply full canonical inputs it should use
 * `runTradeShadowForProposal` (shadow.ts) — this module is the funnel for
 * everything that can't, yet.
 *
 * Never throws. Never mutates. Emits nothing unless the surface's flag is on.
 */
import { emitShadowParity } from '@/lib/decision-os/core/parity'
import { shouldRunShadow } from '@/lib/decision-os/core/shadow'

/**
 * Slice 13: `legacy` and the five `warroom_*` surfaces joined the taxonomy.
 * Until they did, the Phase 3 flip gate could report "ready" while excluding
 * the HIGHEST-TRAFFIC trade surface in the product — the Nocturne dashboard's
 * "Trade Analyzer" tile routes into /af-legacy, not the console.
 */
export type TradeSurface =
  | 'console'
  | 'dynasty'
  | 'keeper'
  | 'draftpick'
  | 'legacy'
  | 'warroom_redraft'
  | 'warroom_dynasty'
  | 'warroom_keeper'
  | 'warroom_bestball'
  | 'warroom_guillotine'

const SURFACE_FLAGS: Record<TradeSurface, string> = {
  console: 'DECISION_OS_TRADE_SHADOW_CONSOLE',
  dynasty: 'DECISION_OS_TRADE_SHADOW_DYNASTY',
  keeper: 'DECISION_OS_TRADE_SHADOW_KEEPER',
  draftpick: 'DECISION_OS_TRADE_SHADOW_DRAFTPICK',
  legacy: 'DECISION_OS_TRADE_SHADOW_LEGACY',
  // All five war rooms share one operational flag — they share one verdict
  // rule — but stay distinct surfaces because they use different value bases,
  // so each converges (or diverges) on its own.
  warroom_redraft: 'DECISION_OS_TRADE_SHADOW_WARROOM',
  warroom_dynasty: 'DECISION_OS_TRADE_SHADOW_WARROOM',
  warroom_keeper: 'DECISION_OS_TRADE_SHADOW_WARROOM',
  warroom_bestball: 'DECISION_OS_TRADE_SHADOW_WARROOM',
  warroom_guillotine: 'DECISION_OS_TRADE_SHADOW_WARROOM',
}

/** Every trade surface that must be instrumented. Coverage is test-enforced. */
export const ALL_TRADE_SURFACES: readonly TradeSurface[] = Object.keys(SURFACE_FLAGS) as TradeSurface[]

export function tradeSurfaceFlagEnvVar(surface: TradeSurface): string {
  return SURFACE_FLAGS[surface]
}

export function shouldRunTradeSurfaceShadow(
  surface: TradeSurface,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return shouldRunShadow(SURFACE_FLAGS[surface], env)
}

export interface TradeSurfaceObservation {
  surface: TradeSurface
  /** Authenticated user, when the surface has one (console allows anonymous browse). */
  userId?: string | null
  leagueId?: string | null
  /** Canonical-input availability — drives the structured skip reason. */
  proposerRosterId?: string | null
  receiverRosterId?: string | null
  seasonId?: string | null
  hasDeterministicSnapshot?: boolean
  /** Trade shape. */
  assetsGive?: number
  assetsGet?: number
  multiTeam?: boolean
  /** The surface's own deterministic verdict fields (for later cross-comparison). */
  surfaceVerdict?: string | null
  surfaceConfidence?: number | null
  surfaceValueDeltaPct?: number | null
  surfaceAnalysisMode?: string | null
  /**
   * Slice 10 — a REAL cross-engine comparison (canonical value engine vs the
   * surface's own verdict). When present the event is `ran: true` with reason
   * 'value_engine_compare' — the sample stream the Phase 3 flip gate counts.
   */
  comparison?: {
    /** Null when the canonical engine refused to grade (insufficient value data). */
    canonicalGrade: string | null
    canonicalFairnessScore: number | null
    canonicalConfidenceScore: number
    canonicalValueDifference: number
    canonicalAdvantage: string | null
    agreement: boolean | null
    /**
     * TRUE when at least one asset was priced from a value the surface did not supply.
     *
     * 🛑 THIS CHANGES WHICH FLIP-GATE BUCKET THE ROW LANDS IN, which is why it is carried up here
     * rather than left as a detail. A comparison fed the surface's own numbers and one fed
     * independent ADP are different STRENGTHS of evidence; `flipReadiness` groups on `surface` and
     * cannot tell them apart, so they must not share a bucket. See
     * docs/adr/ADR_DECISION_OS_PHASE3_WHAT_COUNTS_AS_FLIP_EVIDENCE.md §3.
     */
    independentInputs?: boolean
    /** Resolution rate, so the yield is measured from the first request rather than assumed. */
    playerAssets?: number
    playerAssetsWithId?: number
  } | null
}

/**
 * The single Phase 2 skip taxonomy. Order matters: report the FIRST missing
 * canonical input in the chain league → rosters → snapshot.
 */
export function canonicalInputSkipReason(obs: TradeSurfaceObservation): string {
  if (!obs.leagueId) return 'missing_league_scope'
  if (!obs.proposerRosterId || !obs.receiverRosterId) return 'missing_roster_identity'
  if (!obs.hasDeterministicSnapshot) return 'missing_snapshot'
  return 'full_inputs_available_use_proposal_shadow'
}

/**
 * Record one surface-level shadow observation. Cheap and synchronous; guarded so
 * it can NEVER affect the surface's own response.
 */
export function recordTradeSurfaceShadow(
  obs: TradeSurfaceObservation,
  env: NodeJS.ProcessEnv = process.env,
): void {
  try {
    if (!shouldRunTradeSurfaceShadow(obs.surface, env)) return
    /*
     * 🛑 THE BUCKET FOLLOWS THE EVIDENCE, NOT THE SCREEN. A comparison fed independent values is a
     * different kind of claim from one regrading the surface's own numbers, and `flipReadiness`
     * groups on this string alone. Suffixing rather than replacing keeps the screen readable in the
     * bucket name while stopping the two samples from mixing — and it is decided PER ROW, so a
     * request where nothing resolved stays in the original bucket instead of being promoted.
     *
     * ⚠ NOT a member of `TradeSurface`, deliberately. That union drives `SURFACE_FLAGS` and its
     * test-enforced coverage, and this is a parity-bucket label rather than a screen to instrument
     * — the same way `canonicalShadow` emits 'proposal' without joining the union.
     */
    const paritySurface = obs.comparison?.independentInputs
      ? `${obs.surface}_independent`
      : obs.surface

    emitShadowParity('manager.trade.evaluate', {
      shadow: true,
      surface: paritySurface,
      ran: Boolean(obs.comparison),
      reason: obs.comparison ? 'value_engine_compare' : canonicalInputSkipReason(obs),
      canonicalGrade: obs.comparison?.canonicalGrade ?? null,
      canonicalFairnessScore: obs.comparison?.canonicalFairnessScore ?? null,
      canonicalConfidenceScore: obs.comparison?.canonicalConfidenceScore ?? null,
      canonicalValueDifference: obs.comparison?.canonicalValueDifference ?? null,
      canonicalAdvantage: obs.comparison?.canonicalAdvantage ?? null,
      agreement: obs.comparison ? obs.comparison.agreement : null,
      leagueScoped: Boolean(obs.leagueId),
      authenticated: Boolean(obs.userId),
      /**
       * The IDS, not just the booleans above. `persistParityEvent` lifts `flags.leagueId` and
       * `flags.userId` into their own columns, and until now this recorded only whether they
       * EXISTED — so every trade observation landed with both columns null.
       *
       * That matters for the Phase 3 gate rather than for reporting: without them a sample cannot
       * be scoped to a league, cannot exclude the team's own test leagues, and cannot be weighted
       * per user. A gate satisfied by one enthusiastic tester in one league is not evidence about
       * the surface.
       */
      leagueId: obs.leagueId ?? null,
      userId: obs.userId ?? null,
      assetsGive: obs.assetsGive ?? null,
      assetsGet: obs.assetsGet ?? null,
      multiTeam: Boolean(obs.multiTeam),
      surfaceVerdict: obs.surfaceVerdict ?? null,
      surfaceConfidence: obs.surfaceConfidence ?? null,
      surfaceValueDeltaPct: obs.surfaceValueDeltaPct ?? null,
      surfaceAnalysisMode: obs.surfaceAnalysisMode ?? null,
      /*
       * The screen this came from, kept alongside the bucket. Once `surface` can carry an
       * `_independent` suffix, grouping by it no longer answers "which screen" — and both questions
       * get asked.
       */
      surfaceScreen: obs.surface,
      independentInputs: obs.comparison?.independentInputs ?? false,
      playerAssets: obs.comparison?.playerAssets ?? null,
      playerAssetsWithId: obs.comparison?.playerAssetsWithId ?? null,
    })
  } catch {
    // Shadow instrumentation must never break a surface.
  }
}
