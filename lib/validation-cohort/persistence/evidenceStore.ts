/**
 * Fantasy OS Suite — Phase V8.1: historical evidence store (provider-neutral persistence contract).
 *
 * A persistence layer for the VALIDATION evidence corpus — the discovered portfolios, per-league neutral
 * evidence, and import state that turn historical discovery into reusable, provider-agnostic evidence for
 * Decision OS verification. This is deliberately SEPARATE from the product's operational import
 * (`ImportRun` / `DecisionOsImportedActivity` / `prismaImportedActivityStore`) — it is an internal
 * analytics corpus, not the operational league import, so it does not duplicate that pipeline.
 *
 * The contract is store-agnostic: the `FileEvidenceStore` here is the fixture/smoke-verified
 * implementation; a Prisma-backed implementation (reusing the existing store patterns) is a drop-in that
 * satisfies the same interface without changing any caller. Provider identifiers never appear here —
 * everything is anonymized `acct_`/`lg_` references and provider-neutral facts.
 */
import type { NormalizedLeagueFacts, EvidenceCategory, DiscoveredLeague } from '../types'
import type { LeagueEvidenceBundle } from '../evidence/contracts'
import type { ActivityEvidence } from '../evidence/activityEvidence'

export const EVIDENCE_STORE_VERSION = '8.2.0'

/** One league's persisted evidence. `evidence` marks only categories an import actually OBSERVED. */
export type PersistedLeagueEvidence = {
  leagueReference: string
  season: string
  sport: string
  previousLeagueRef: string | null
  role: DiscoveredLeague['role']
  /** Provider-neutral facts (from the V7.1 normalization). Present once the league's facts were imported. */
  facts?: NormalizedLeagueFacts
  /** Observed evidence categories (metadata/rosters/trades/... ) — never assumed, only what was seen. */
  evidence: Partial<Record<EvidenceCategory, boolean>>
  /** V8.2: the full normalized evidence bundle (rosters/matchups/transactions/draft/postseason). */
  bundle?: LeagueEvidenceBundle
  /** V8.2: pure activity evidence derived from the bundle. */
  activity?: ActivityEvidence
  /** Completed (non-current) seasons are immutable — imported once, then never rewritten. */
  seasonImmutable: boolean
  importedAt: string
}

/** One account's persisted portfolio summary. */
export type PersistedPortfolio = {
  accountReference: string
  seasonsDiscovered: string[]
  leagueRefs: string[]
  updatedAt: string
}

/** Provider-neutral import-state tracking (Part 4). Restartable without corruption. */
export type ImportState = {
  storeVersion: string
  lastSuccessfulSync: string | null
  lastAttemptedSync: string | null
  lastSyncDurationMs: number | null
  importedSeasons: string[]
  importedLeagues: number
  importedTransactions: number
  skippedRecords: number
  retryCount: number
  partialFailures: { stage: string; ref?: string; message: string }[]
}

export function emptyImportState(): ImportState {
  return {
    storeVersion: EVIDENCE_STORE_VERSION,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastSyncDurationMs: null,
    importedSeasons: [],
    importedLeagues: 0,
    importedTransactions: 0,
    skippedRecords: 0,
    retryCount: 0,
    partialFailures: [],
  }
}

/**
 * Store contract. Implementations must be idempotent (upsert by reference) and safe to restart — a
 * re-run must not corrupt or duplicate state.
 */
export interface HistoricalEvidenceStore {
  upsertPortfolio(portfolio: PersistedPortfolio): Promise<void>
  upsertLeagueEvidence(evidence: PersistedLeagueEvidence): Promise<void>
  hasLeague(leagueReference: string): Promise<boolean>
  getLeague(leagueReference: string): Promise<PersistedLeagueEvidence | null>
  listLeagues(): Promise<PersistedLeagueEvidence[]>
  listPortfolios(): Promise<PersistedPortfolio[]>
  readImportState(): Promise<ImportState>
  writeImportState(state: ImportState): Promise<void>
}
