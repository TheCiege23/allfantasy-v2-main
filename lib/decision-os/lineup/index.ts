/**
 * Decision OS — `manager.lineup.set` orchestrator + barrel (Slice 1).
 *
 * Pure end-to-end thread: World Resolution (read-only) → DCO (read-only) → Decision (DCO-only) →
 * optional Parity (shadow). Prisma reads happen in an injected loader at the route seam (deps.ts),
 * never here — so the whole orchestrator unit-tests without a DB.
 */
import type { RedraftLineupPlayer } from '@/lib/redraft/lineupValidation'
import type { LineupActionItem, LineupActionSummaryPayload } from '@/lib/lineup-actions/types'
import type { Decision } from '@/lib/decision-os/core/decision'
import { resolveLineupWorld, type LineupWorld, type LineupWorldDeps } from './world'
import { buildLineupDCO, type LineupDCO } from './dco'
import { decideLineupSet, type LineupDecisionDeps } from './decision'
import { compareLineupParity, type LineupParityResult } from './parity'
import type { LineupWarehouseFacts } from './warehouseFacts'
import type { LineupSignalFacts } from './signalFacts'

export * from './world'
export * from './dco'
export * from './rules'
export * from './decision'
export * from './todayCardAdapter'
export * from './parity'
export * from './outcome'

export interface RunLineupSetInput {
  sport: string
  leagueSettings: unknown
  leagueWeek: number
  editingWeek: number
  userId: string
  leagueId: string
  rosterId: string | null
  players: RedraftLineupPlayer[]
  proposed?: RedraftLineupPlayer[]
  projectionConfidence?: number | null
  scanIncomplete?: boolean
  /** Optional F2.9/F2.10 warehouse grounding (ADR F2.10) — memo/explainability enrichment only. */
  warehouse?: LineupWarehouseFacts
  /** Optional F2.2–F2.7 signal grounding — memo/explainability enrichment only. */
  signals?: LineupSignalFacts
}

export interface RunLineupSetDeps {
  world?: LineupWorldDeps
  decision: LineupDecisionDeps
  /** When present, run the Parity Gate against the legacy recommender (shadow mode). */
  shadow?: { legacyRecommend: (userId: string) => Promise<LineupActionSummaryPayload> }
}

export interface RunLineupSetResult {
  world: LineupWorld
  dco: LineupDCO
  decision: Decision<LineupActionItem>
  parity?: LineupParityResult
}

export async function runLineupSetDecision(input: RunLineupSetInput, deps: RunLineupSetDeps): Promise<RunLineupSetResult> {
  const world = resolveLineupWorld(
    { sport: input.sport, leagueSettings: input.leagueSettings, leagueWeek: input.leagueWeek, editingWeek: input.editingWeek },
    deps.world,
  )
  const dco = buildLineupDCO({
    world,
    userId: input.userId,
    leagueId: input.leagueId,
    sport: input.sport,
    rosterId: input.rosterId,
    players: input.players,
    proposed: input.proposed,
    projectionConfidence: input.projectionConfidence,
    scanIncomplete: input.scanIncomplete,
    warehouse: input.warehouse,
    signals: input.signals,
  })
  const decision = await decideLineupSet(dco, deps.decision)

  let parity: LineupParityResult | undefined
  if (deps.shadow) {
    const legacy = await deps.shadow.legacyRecommend(input.userId)
    // 🛑 THE PARITY RESULT IS RETURNED, NOT EMITTED. This used to also fire `emitShadowParity` with
    // `{ legacy_shadow_compared: true, parity_passed }` and NO `ran` key. `runLineupShadow` is the
    // only caller that passes `deps.shadow`, and it emits its own `ran: true` event immediately
    // afterwards from this very `parity` object under the same `decision_id` — so every row this
    // wrote was the second copy of a verdict already counted.
    //
    // It was not merely redundant. `flipReadiness` counts a comparison only when `flags.ran === true`;
    // everything else falls to the skip branch under reason 'unknown'. Measured in production before
    // removal: 2,813 lineup decisions each held exactly two rows, and 2,815 real verdicts sat in the
    // skip bucket, making 2/3 of the reported skips fiction and doubling the table.
    //
    // ⚠ Removing the emit does NOT change the gate's arithmetic — the twin was never counted as a
    // comparison, so agreements, disagreements and the agreement rate are untouched. What changes is
    // that `skips` stops lying and the row count halves.
    //
    // ⚠ The other caller, `grounding/decisionBridge`, passes no `shadow` at all (see its header), so
    // nothing else ever reached this line. If a future caller wants telemetry, it emits its own with
    // `ran` set — an emit buried in the orchestrator cannot know the surface or the input source, and
    // that is exactly why this one carried neither.
    parity = compareLineupParity(decision, legacy, input.leagueId)
  }

  return { world, dco, decision, parity }
}
