/**
 * Fantasy OS Phase 4 — provider-neutral row shapes for the executive intelligence data-access boundary.
 *
 * These are the ONLY shapes the derivation layer sees. They intentionally do NOT mirror raw Sleeper
 * payloads — they are neutral portfolio facts sourced from the certified `fos_phase4` schema (which was
 * itself mapped from Sleeper during discovery). No provider field names leak past this file.
 */

/** One persisted league-season (neutral). Counts are the bounded weeks-1..18 discovery sample. */
export type ExecLeagueRow = {
  leagueId: string
  season: string
  name: string | null
  status: string | null
  totalRosters: number | null
  previousLeagueId: string | null
  isMembership: boolean
  formatType: 'redraft' | 'keeper' | 'dynasty' | 'unknown'
  seedRole: 'commissioner' | 'member' | 'ancestor'
  scoringKeys: number
  rosterPositions: string[]
  users: number
  rosters: number
  commissioners: number
  drafts: number
  draftPicks: number
  tradedFuturePicks: number
  matchupRecords: number
  weeksWithMatchups: number
  transactions: number
  trades: number
  waivers: number
  freeAgents: number
  faab: number
  hasWinnersBracket: boolean
  hasLosersBracket: boolean
}

/** One unique real manager (canonical by Sleeper user_id; display name is mutable metadata). */
export type ExecManagerRow = {
  userId: string
  displayName: string | null
  isCommissioner: boolean
  leagueCount: number
  seasonCount: number
  teamNames: string[]
}

/** The certified import-run metadata (authoritative totals + provenance). */
export type ExecImportRun = {
  runId: string
  manifestHash: string
  seedUserId: string
  seedUsername: string | null
  generatedAt: string
  schemaVersion: string
  calcVersion: string
  importedAt: string
  seasons: string[]
  /** Authoritative aggregate totals captured at discovery time (used for reconciliation). */
  totals: Record<string, number | string | string[]>
  api: Record<string, number>
  warnings: string[]
}

/** The full neutral snapshot the derivation layer consumes. Small by design (hundreds of rows). */
export type ExecSnapshot = {
  run: ExecImportRun
  leagues: ExecLeagueRow[]
  managers: ExecManagerRow[]
  continuityChainCount: number
}

/** Result of a fetch attempt. `available:false` is a first-class, fail-closed state (never fabricated). */
export type ExecSnapshotResult =
  | { available: true; snapshot: ExecSnapshot }
  | { available: false; reason: 'disabled' | 'unavailable'; detail: string }
