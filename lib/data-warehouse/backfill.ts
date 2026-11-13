/**
 * Warehouse backfill orchestrator — runs ingestion pipelines for leagues and/or game stats.
 * Call from POST /api/admin/warehouse/backfill or a scheduled job.
 */

export type BackfillPipeline = 'gameStats' | 'matchups' | 'standings' | 'rosterSnapshots' | 'drafts' | 'transactions'

type BackfillErrorPipeline = BackfillPipeline | 'orchestrator'

interface BackfillObservability {
  startedAt: string
  finishedAt: string
  totalDurationMs: number
  pipelineDurationMs: Partial<Record<BackfillPipeline, number>>
  errorsByLeague: Array<{
    leagueId: string
    byPipeline: Partial<Record<BackfillErrorPipeline, string[]>>
  }>
}

export interface BackfillOptions {
  /** Specific league IDs; if empty, all leagues matching sport/season are used */
  leagueIds?: string[]
  /** Filter leagues by sport (e.g. NFL) */
  sport?: string
  /** Season year (e.g. 2024). Used for standings, matchups, roster; and for game stats if run */
  season?: number
  /** Week numbers to run for matchups/roster (e.g. [1,2,3,...,14]). If omitted, 1–18 are used for league backfill */
  weeks?: number[]
  /** Which pipelines to run. Default: all except gameStats (gameStats requires sport+season+weeks) */
  pipelines?: BackfillPipeline[]
  /** If true, only report what would be run; do not write */
  dryRun?: boolean
}

export interface BackfillResult {
  ok: boolean
  dryRun: boolean
  leaguesProcessed: number
  gameStats?: { sport: string; season: number; week: number; playerFacts: number; teamFacts: number; status?: string }[]
  /** Weeks whose source stat tables were empty (MISSING_SOURCE_DATA) — actionable, not a success. */
  gameStatsWarnings?: string[]
  standings?: { leagueId: string; season: number; standingCount: number }[]
  matchups?: { leagueId: string; season: number; week: number; matchupCount: number }[]
  rosterSnapshots?: { leagueId: string; weekOrPeriod: number; snapshotCount: number }[]
  drafts?: { leagueId: string; draftFactCount: number }[]
  transactions?: { leagueId: string; transactionCount: number }[]
  errors: string[]
  observability: BackfillObservability
}

