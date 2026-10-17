/**
 * Decision OS — `manager.lineup.set` orchestrator + barrel (Slice 1).
 *
 * Pure end-to-end thread: World Resolution (read-only) → DCO (read-only) → Decision (DCO-only).
 * Prisma reads happen in an injected loader at the seam (loader.ts / deps.ts), never here — so the
 * whole orchestrator unit-tests without a DB.
 *
 * ⚠ RETIRED AS A STANDALONE ENGINE 2026-09-29. /core My Team (`lib/core-app/myTeam.ts`) is the one
 * start/sit answer. The shadow runner, its ten-minute sweep, the parity gate against the legacy
 * recommender, the canonical-world bridge and the Today card adapter were deleted with the two
 * routes that surfaced them (`/api/today/lineup-actions`, `/api/dashboard/today-actions`). What
 * remains is only what Chimmy's grounding packet reaches: `grounding/decisionBridge.ts` calls
 * `loadLineupSetInputs` → `runLineupSetDecision` for its `lineupDecision` slice.
 */
import type { RedraftLineupPlayer } from '@/lib/redraft/lineupValidation'
import type { LineupActionItem } from '@/lib/lineup-actions/types'
import type { Decision } from '@/lib/decision-os/core/decision'
import { resolveLineupWorld, type LineupWorld, type LineupWorldDeps } from './world'
import { buildLineupDCO, type LineupDCO } from './dco'
import { decideLineupSet, type LineupDecisionDeps } from './decision'
import type { LineupWarehouseFacts } from './warehouseFacts'
import type { LineupSignalFacts } from './signalFacts'

export * from './world'
export * from './dco'
export * from './rules'
export * from './decision'
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
}

export interface RunLineupSetResult {
  world: LineupWorld
  dco: LineupDCO
  decision: Decision<LineupActionItem>
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

  return { world, dco, decision }
}
