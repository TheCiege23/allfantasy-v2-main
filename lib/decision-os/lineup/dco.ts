/**
 * Decision OS — Decision Context Object for `manager.lineup.set` (Slice 1).
 *
 * READ-ONLY assembly. The DCO is the ONLY thing the Lineup Intelligence decision may consume —
 * no decision engine resolves league/scoring/config directly. Facts arrive already loaded (the
 * read happens in an injected loader, Context Resolution's data-loading seam); this module only
 * shapes them. No prisma, no writes.
 */
import type { RedraftLineupPlayer } from '@/lib/redraft/lineupValidation'
import type { DecisionProvenance } from '@/lib/decision-os/core/decision'
import type { LineupWorld, LockState } from './world'
import type { LineupWarehouseFacts } from './warehouseFacts'

export interface LineupDCO {
  decision_type: 'manager.lineup.set'
  world: LineupWorld
  user: { userId: string }
  league: { leagueId: string; sport: string }
  roster: { rosterId: string | null; players: RedraftLineupPlayer[] }
  /** The lineup being evaluated (defaults to current roster's starters). */
  lineup: { proposed: RedraftLineupPlayer[] }
  lock_state: LockState
  confidence_inputs: { projectionConfidence: number | null }
  provenance: DecisionProvenance
  /** 0–100. */
  data_completeness: number
  uncertainty: string[]
  simulation_available: boolean
  /**
   * F2.9/F2.10 warehouse grounding (ADR F2.10) — ENRICHMENT ONLY. Feeds memo/uncertainty/
   * explainability; the deterministic rules never read it. Absent = not loaded (older callers),
   * which is different from loaded-but-unavailable (a LineupWarehouseFacts with nulls).
   */
  warehouse?: LineupWarehouseFacts
}

export interface LineupDCOInput {
  world: LineupWorld
  userId: string
  leagueId: string
  sport: string
  rosterId: string | null
  players: RedraftLineupPlayer[]
  proposed?: RedraftLineupPlayer[]
  projectionConfidence?: number | null
  /** When provider/projection data was incomplete (e.g., live fetch failed). */
  scanIncomplete?: boolean
  /** Optional F2.9/F2.10 warehouse grounding — see LineupDCO.warehouse. */
  warehouse?: LineupWarehouseFacts
}

/** Pure, read-only DCO assembly with honest provenance + completeness. */
export function buildLineupDCO(input: LineupDCOInput): LineupDCO {
  const uncertainty: string[] = []
  if (input.world.lock_state.uncertainty) uncertainty.push(input.world.lock_state.uncertainty)
  if (input.scanIncomplete) uncertainty.push('Live lineup/projection data could not be fully verified.')
  if (input.projectionConfidence == null) uncertainty.push('Projection confidence unavailable.')
  // Warehouse grounding gaps surface as uncertainty — never as fabricated history (P2).
  if (input.warehouse) uncertainty.push(...input.warehouse.uncertainty)

  // Weakest required input drives completeness/provenance (honesty contract).
  const weakest: DecisionProvenance = input.scanIncomplete
    ? { weakest_source: 'provider', weakest_trust: 'low' }
    : { weakest_source: 'derived', weakest_trust: 'high' }
  const data_completeness = input.scanIncomplete ? 60 : input.projectionConfidence == null ? 80 : 100

  return {
    decision_type: 'manager.lineup.set',
    world: input.world,
    user: { userId: input.userId },
    league: { leagueId: input.leagueId, sport: input.sport },
    roster: { rosterId: input.rosterId, players: input.players },
    lineup: { proposed: input.proposed ?? input.players },
    lock_state: input.world.lock_state,
    confidence_inputs: { projectionConfidence: input.projectionConfidence ?? null },
    provenance: weakest,
    data_completeness,
    uncertainty,
    simulation_available: false, // Slice 1 placeholder (Art. XVII wired in a later slice)
    ...(input.warehouse ? { warehouse: input.warehouse } : {}),
  }
}
