/**
 * Draft import types. Deterministic mapping and validation; sport-aware.
 * Supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, Soccer.
 */

/** Single error or warning from validation. */
interface ImportErrorItem {
  code: string
  message: string
  /** Optional field path (e.g. "picks[3].playerName") */
  field?: string
  /** Optional severity for UI */
  severity?: 'error' | 'warning'
}

/** Structured error report for import flow. */
export interface ImportErrorReport {
  errors: ImportErrorItem[]
  warnings: ImportErrorItem[]
  /** True if import can proceed (only warnings, no blocking errors). */
  canProceed: boolean
}

/** External payload: draft order entry (slot/team). */
export interface RawDraftOrderEntry {
  slot?: number
  rosterId?: string
  displayName?: string
  teamName?: string
  ownerName?: string
}

/** External payload: single pick. */
export interface RawPickEntry {
  overall?: number
  round?: number
  slot?: number
  rosterId?: string
  displayName?: string
  playerName: string
  position: string
  team?: string | null
  byeWeek?: number | null
  playerId?: string | null
  amount?: number | null
  source?: string | null
}

/** External payload: traded pick. */
export interface RawTradedPickEntry {
  round: number
  originalRosterId?: string
  previousOwnerName?: string
  newRosterId?: string
  newOwnerName?: string
}

/** External payload: keeper config. */
export interface RawKeeperConfig {
  maxKeepers?: number
  deadline?: string | null
  maxKeepersPerPosition?: Record<string, number>
}

/** External payload: keeper selection. */
export interface RawKeeperSelection {
  rosterId?: string
  displayName?: string
  roundCost: number
  playerName: string
  position: string
  team?: string | null
  playerId?: string | null
}

/** Supported external source identifier. */
type ImportSource = 'sleeper' | 'espn' | 'manual' | 'generic'

/** Top-level import payload (generic shape). */
export interface RawDraftImportPayload {
  source?: ImportSource
  draftOrder?: RawDraftOrderEntry[]
  picks?: RawPickEntry[]
  tradedPicks?: RawTradedPickEntry[]
  keeperConfig?: RawKeeperConfig
  keeperSelections?: RawKeeperSelection[]
  metadata?: {
    rounds?: number
    teamCount?: number
    draftType?: 'snake' | 'linear' | 'auction'
    thirdRoundReversal?: boolean
  }
}
