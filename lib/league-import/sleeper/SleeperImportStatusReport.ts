/**
 * Structured Sleeper import status/gap reporting — Fantasy OS Migration Plan
 * Milestone 2 (Sleeper import hardening).
 *
 * Derives a per-field report from the EXISTING `NormalizedImportResult.coverage`
 * self-report plus the new `fetch_warnings` this phase adds (see SleeperAdapter.ts)
 * — this does not replace `ImportCoverage`, which remains the system of record
 * the preview/commit pipeline actually reads. This report is an additive,
 * richer status/gap view on top of it, shaped so it can later feed the Fantasy
 * Knowledge Graph's source-attribution/freshness/confidence model without
 * requiring any change to the commit pipeline itself.
 */

import type { ImportCoverage, ImportCoverageKey, NormalizedImportResult } from '../types'

export type ImportFieldStatus = 'imported' | 'skipped' | 'failed' | 'partial' | 'unsupported' | 'stale'

export interface ImportFieldReport {
  field: string
  status: ImportFieldStatus
  provider: 'sleeper'
  fetchedAt: string | null
  note: string | null
}

export interface SleeperImportStatusReport {
  provider: 'sleeper'
  fetchedAt: string | null
  /** True when `fetchedAt` is older than `staleThresholdMs` — see `buildSleeperImportStatusReport`. */
  isStale: boolean
  hasFailures: boolean
  fields: ImportFieldReport[]
}

/**
 * Maps each `ImportCoverage` bucket to the fetch field tag(s) that can produce
 * a `failed` status for it (see SleeperFetchWarning.field in
 * lib/league-import/adapters/sleeper/types.ts). `null` means no direct fetch
 * warning can be attributed to this bucket today — a known limitation, not a
 * silent gap: `playerIdentityMap` is populated via `getAllPlayers()`, which has
 * its own internal try/catch this phase does not touch (see module README).
 */
const COVERAGE_TO_FETCH_FIELD: Record<ImportCoverageKey, string | null> = {
  leagueSettings: 'league',
  currentRosters: 'rosters',
  historicalRosterSnapshots: 'previousSeasons',
  scoringSettings: 'league',
  playoffSettings: 'league',
  currentStandings: 'rosters',
  currentSchedule: 'matchups',
  draftHistory: 'draftPicks',
  tradeHistory: 'transactions',
  previousSeasons: 'previousSeasons',
  playerIdentityMap: null,
}

/**
 * Coverage buckets that are 'missing' by design during preview normalization
 * (completed later, during post-import backfill) — never a failure, and
 * distinct from data Sleeper simply didn't return.
 */
const DEFERRED_TO_BACKFILL: ReadonlySet<ImportCoverageKey> = new Set(['historicalRosterSnapshots'])

const DEFAULT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24h

function deriveFieldStatus(
  key: ImportCoverageKey,
  bucket: ImportCoverage[ImportCoverageKey],
  hasFetchFailure: boolean
): ImportFieldStatus {
  if (hasFetchFailure) return 'failed'
  if (bucket.state === 'full') return 'imported'
  if (bucket.state === 'partial') return 'partial'
  // state === 'missing', no fetch failure recorded against it
  if (DEFERRED_TO_BACKFILL.has(key)) return 'skipped'
  return 'skipped'
}

export interface BuildSleeperImportStatusReportOptions {
  /** Age after which a successfully-imported field is reported as `stale` instead. Default 24h. */
  staleThresholdMs?: number
  /** Reference "now" for staleness calculation — injectable for tests. */
  now?: Date
}

export function buildSleeperImportStatusReport(
  normalized: NormalizedImportResult,
  options: BuildSleeperImportStatusReportOptions = {}
): SleeperImportStatusReport {
  const staleThresholdMs = options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS
  const now = options.now ?? new Date()
  const fetchedAt = normalized.source.imported_at ?? null

  const failedFields = new Set(
    (normalized.fetch_warnings ?? [])
      .map((w) => (typeof w.metadata?.field === 'string' ? w.metadata.field : null))
      .filter((f): f is string => f != null)
  )

  const isStale = fetchedAt != null && now.getTime() - new Date(fetchedAt).getTime() > staleThresholdMs

  const fields: ImportFieldReport[] = (Object.keys(normalized.coverage) as ImportCoverageKey[]).map((key) => {
    const bucket = normalized.coverage[key]
    const mappedFetchField = COVERAGE_TO_FETCH_FIELD[key]
    const hasFetchFailure = mappedFetchField != null && failedFields.has(mappedFetchField)
    let status = deriveFieldStatus(key, bucket, hasFetchFailure)

    if (isStale && (status === 'imported' || status === 'partial')) {
      status = 'stale'
    }

    return {
      field: key,
      status,
      provider: 'sleeper',
      fetchedAt,
      note: bucket.note ?? null,
    }
  })

  // Playoff bracket RESULTS (not settings/structure — see ImportCoverage.playoffSettings,
  // which only covers structure) has no coverage bucket at all today for any provider.
  // Reported honestly as `unsupported` rather than omitted, per the Migration Plan's
  // "missing schema: PlayoffBracket.results" blocker (Part 9).
  fields.push({
    field: 'playoffBracketResults',
    status: 'unsupported',
    provider: 'sleeper',
    fetchedAt,
    note: 'Playoff bracket outcomes (not just structure) are not modeled in the canonical schema yet for any provider.',
  })

  return {
    provider: 'sleeper',
    fetchedAt,
    isStale,
    hasFailures: failedFields.size > 0,
    fields,
  }
}
