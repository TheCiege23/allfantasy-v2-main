/**
 * Decision OS Manager Intelligence Platform — Phase 4.
 *
 * `ManagerTransactionReadinessV1`: the final core Manager Intelligence display
 * contract. It answers "how ready is this roster for transactions?" with
 * DETERMINISTIC, OBSERVATIONAL facts — never a specific waiver, trade, drop,
 * add, or player target.
 *
 * This is READINESS, not opportunity discovery: every field is derived from
 * persisted roster/league data only (RedraftRosterPlayer slots + injuries + byes,
 * and the league's resolved roster-size config). NO AI, NO waiver/trade
 * recommendation endpoint, NO external live waiver pool or AI-generated player
 * value. When a signal can't be derived it is reported honestly as `'unknown'`
 * (or `0` + a caveat), never fabricated.
 */

export const MANAGER_TRANSACTION_READINESS_VERSION = 'manager-transaction-readiness.v1'

export type PressureLevel = 'low' | 'moderate' | 'high' | 'unknown'
export type BenchFlexibility = 'flexible' | 'limited' | 'tight' | 'unknown'

export interface ManagerTransactionReadinessV1 {
  version: typeof MANAGER_TRANSACTION_READINESS_VERSION
  derivedAt: string

  /** Overall transaction pressure this week (composite of the signals below). */
  rosterPressure: PressureLevel
  benchFlexibility: BenchFlexibility
  injuryPressure: PressureLevel
  byePressure: PressureLevel

  /** Open roster slots = configured max roster size − active players (0 if unknown). */
  rosterOpenings: number
  /** All active non-starters (bench + IR + taxi/devy + other reserves). */
  reserveCount: number
  /** Players sitting in an IR slot. */
  injuredReserveCount: number
  /** Promotable bench players (bench / bn / reserve slots). */
  benchCount: number

  /** Deterministic, observational one-liner — templated from the fields above. */
  summary: string
  /** Honest disclaimers about what could NOT be determined (never advice). */
  caveats: string[]
}

// ── pure aggregator inputs (Prisma-decoupled) ────────────────────────────────

export interface TransactionReadinessRosterPlayerInput {
  slotType: string | null | undefined
  injuryStatus?: string | null
  byeWeek?: number | null
  /** Active roster only — dropped players are ignored by the aggregator. */
  droppedAt?: Date | string | null
}

/**
 * Resolved roster-size config, mapped by the resolver from the canonical
 * `resolveRedraftRosterConfig`. `source` lets the aggregator honestly caveat
 * open-slot counts that come from the format default rather than a
 * commissioner-configured limit. Null → open slots can't be counted.
 */
export interface TransactionReadinessRosterConfigInput {
  maxRosterSize: number
  source: 'commissioner' | 'defaults'
}

export interface TransactionReadinessAggregationInput {
  players: TransactionReadinessRosterPlayerInput[]
  /** RedraftSeason.currentWeek; drives bye pressure (0/null → no bye counted). */
  currentWeek: number | null | undefined
  rosterConfig: TransactionReadinessRosterConfigInput | null
}
