export type LeaguePlayerWeeklyScoreCandidateInput = {
  leagueId: string
  playerId: string
  season: number
  week: number
  sport: string
  fantasyPts: number
  stats?: Record<string, unknown> | null
  isFinalized?: boolean
  source?: string
  lineageJobName?: string | null
  rollupVersion?: number | null
  scoringProfileId?: string | null
  scoringRulesHash?: string | null
}

export type LeaguePlayerWeeklyScoreCandidateRow = {
  leagueId: string
  playerId: string
  season: number
  week: number
  sport: string
  fantasyPts: number
  stats: Record<string, unknown> | null
  isFinalized: boolean
  source: string
  lineageJobName: string | null
  rollupVersion: number | null
  scoringProfileId: string | null
  scoringRulesHash: string | null
}

export type ShadowPersistResult = {
  writeRequested: boolean
  writeApplied: boolean
  candidateCount: number
  uniqueKeyCount: number
  duplicateInputCount: number
  scoringRulesHashMissingCount: number
  wouldUpsert: number
  writtenCreate: number
  writtenUpdate: number
  skipped: number
  wroteRows: number
  durationMs: number
  notes: string[]
}

export interface LeaguePlayerWeeklyScoreWriterAdapter {
  upsertMany(rows: LeaguePlayerWeeklyScoreCandidateRow[]): Promise<{
    wroteRows: number
    writtenCreate: number
    writtenUpdate: number
    skipped: number
  }>
}

export type ShadowWriteTelemetryPayload = {
  jobName: string
  leagueId: string | null
  season: number | null
  week: number | null
  writeRequested?: boolean
  writeApplied?: boolean
  candidateCount: number
  uniqueKeyCount: number
  duplicateInputCount?: number
  scoringRulesHashMissingCount?: number
  wouldUpsert?: number
  writtenCount?: number
  writtenCreate?: number
  writtenUpdate?: number
  skipped?: number
  durationMs?: number
  reason?: string
  notes?: string[]
}

type ShadowWriteEvent =
  | 'shadow_write_started'
  | 'shadow_write_completed'
  | 'shadow_write_blocked'
  | 'shadow_write_failed'
  | 'duplicate_candidate_keys'
  | 'scoring_rules_hash_missing'

const DEFAULT_SOURCE = 'rollup_pgs'

export function toLeaguePlayerWeeklyScoreKey(row: {
  leagueId: string
  playerId: string
  week: number
  season: number
  sport: string
}): string {
  return `${row.leagueId}\0${row.playerId}\0${row.season}\0${row.week}\0${row.sport}`
}

export function buildLeaguePlayerWeeklyScoreCandidate(
  input: LeaguePlayerWeeklyScoreCandidateInput,
): LeaguePlayerWeeklyScoreCandidateRow {
  return {
    leagueId: input.leagueId,
    playerId: input.playerId,
    season: input.season,
    week: input.week,
    sport: input.sport,
    fantasyPts: Math.round(input.fantasyPts * 100) / 100,
    stats: input.stats ?? null,
    isFinalized: Boolean(input.isFinalized),
    source: input.source ?? DEFAULT_SOURCE,
    lineageJobName: input.lineageJobName ?? null,
    rollupVersion: input.rollupVersion ?? null,
    scoringProfileId: input.scoringProfileId ?? null,
    scoringRulesHash: input.scoringRulesHash ?? null,
  }
}

export function buildLeaguePlayerWeeklyScoreCandidates(
  inputs: LeaguePlayerWeeklyScoreCandidateInput[],
): {
  candidates: LeaguePlayerWeeklyScoreCandidateRow[]
  uniqueKeyCount: number
  duplicateInputCount: number
} {
  const map = new Map<string, LeaguePlayerWeeklyScoreCandidateRow>()
  for (const input of inputs) {
    const row = buildLeaguePlayerWeeklyScoreCandidate(input)
    map.set(toLeaguePlayerWeeklyScoreKey(row), row)
  }
  return {
    candidates: [...map.values()],
    uniqueKeyCount: map.size,
    duplicateInputCount: Math.max(0, inputs.length - map.size),
  }
}

export async function persistLeaguePlayerWeeklyScoreCandidates(input: {
  candidates: LeaguePlayerWeeklyScoreCandidateRow[]
  write?: boolean
  /**
   * Safety rail: writes remain disabled unless this is true.
   * Phase 7H default is false.
   */
  allowShadowWrite?: boolean
  adapter?: LeaguePlayerWeeklyScoreWriterAdapter
  jobName?: string
  leagueId?: string | null
  season?: number | null
  week?: number | null
  telemetry?: (event: ShadowWriteEvent, payload: ShadowWriteTelemetryPayload) => void
}): Promise<ShadowPersistResult> {
  const startedAt = Date.now()
  const writeRequested = Boolean(input.write)
  const allowShadowWrite = Boolean(input.allowShadowWrite)
  const jobName = input.jobName ?? 'league_player_weekly_score_shadow_store'
  const notes: string[] = []
  const uniqueKeyCount = new Set(input.candidates.map((r) => toLeaguePlayerWeeklyScoreKey(r))).size
  const duplicateInputCount = Math.max(0, input.candidates.length - uniqueKeyCount)
  const scoringRulesHashMissingCount = input.candidates.reduce((sum, row) => {
    return sum + (!row.scoringRulesHash || !row.scoringRulesHash.trim() ? 1 : 0)
  }, 0)
  const wouldUpsert = uniqueKeyCount
  const basePayload = {
    jobName,
    leagueId: input.leagueId ?? null,
    season: input.season ?? null,
    week: input.week ?? null,
    writeRequested,
    candidateCount: input.candidates.length,
    uniqueKeyCount,
  }

  if (duplicateInputCount > 0) {
    input.telemetry?.('duplicate_candidate_keys', {
      ...basePayload,
      duplicateInputCount,
    })
  }

  if (scoringRulesHashMissingCount > 0) {
    input.telemetry?.('scoring_rules_hash_missing', {
      ...basePayload,
      scoringRulesHashMissingCount,
    })
  }

  if (!writeRequested) {
    notes.push('dry_run_only')
    const durationMs = Date.now() - startedAt
    return {
      writeRequested,
      writeApplied: false,
      candidateCount: input.candidates.length,
      uniqueKeyCount,
      duplicateInputCount,
      scoringRulesHashMissingCount,
      wouldUpsert,
      writtenCreate: 0,
      writtenUpdate: 0,
      skipped: 0,
      wroteRows: 0,
      durationMs,
      notes,
    }
  }

  if (!allowShadowWrite) {
    notes.push('write_blocked_allowShadowWrite_required')
    const durationMs = Date.now() - startedAt
    input.telemetry?.('shadow_write_blocked', {
      ...basePayload,
      writeApplied: false,
      duplicateInputCount,
      scoringRulesHashMissingCount,
      wouldUpsert,
      durationMs,
      reason: 'allowShadowWrite_required',
      notes,
    })
    return {
      writeRequested,
      writeApplied: false,
      candidateCount: input.candidates.length,
      uniqueKeyCount,
      duplicateInputCount,
      scoringRulesHashMissingCount,
      wouldUpsert,
      writtenCreate: 0,
      writtenUpdate: 0,
      skipped: 0,
      wroteRows: 0,
      durationMs,
      notes,
    }
  }

  if (!input.adapter) {
    notes.push('write_not_executed_missing_adapter')
    const durationMs = Date.now() - startedAt
    input.telemetry?.('shadow_write_blocked', {
      ...basePayload,
      writeApplied: false,
      duplicateInputCount,
      scoringRulesHashMissingCount,
      wouldUpsert,
      durationMs,
      reason: 'missing_adapter',
      notes,
    })
    return {
      writeRequested,
      writeApplied: false,
      candidateCount: input.candidates.length,
      uniqueKeyCount,
      duplicateInputCount,
      scoringRulesHashMissingCount,
      wouldUpsert,
      writtenCreate: 0,
      writtenUpdate: 0,
      skipped: 0,
      wroteRows: 0,
      durationMs,
      notes,
    }
  }

  input.telemetry?.('shadow_write_started', {
    ...basePayload,
    writeApplied: false,
    duplicateInputCount,
    scoringRulesHashMissingCount,
    wouldUpsert,
  })

  try {
    const { wroteRows, writtenCreate, writtenUpdate, skipped } = await input.adapter.upsertMany(input.candidates)
    notes.push('shadow_write_applied')
    const durationMs = Date.now() - startedAt
    input.telemetry?.('shadow_write_completed', {
      ...basePayload,
      writeApplied: true,
      duplicateInputCount,
      scoringRulesHashMissingCount,
      wouldUpsert,
      writtenCount: wroteRows,
      writtenCreate,
      writtenUpdate,
      skipped,
      durationMs,
      notes,
    })
    return {
      writeRequested,
      writeApplied: true,
      candidateCount: input.candidates.length,
      uniqueKeyCount,
      duplicateInputCount,
      scoringRulesHashMissingCount,
      wouldUpsert,
      writtenCreate,
      writtenUpdate,
      skipped,
      wroteRows,
      durationMs,
      notes,
    }
  } catch (err) {
    notes.push('shadow_write_failed')
    const durationMs = Date.now() - startedAt
    input.telemetry?.('shadow_write_failed', {
      ...basePayload,
      writeApplied: false,
      duplicateInputCount,
      scoringRulesHashMissingCount,
      wouldUpsert,
      durationMs,
      reason: err instanceof Error ? err.message : String(err),
      notes,
    })
    return {
      writeRequested,
      writeApplied: false,
      candidateCount: input.candidates.length,
      uniqueKeyCount,
      duplicateInputCount,
      scoringRulesHashMissingCount,
      wouldUpsert,
      writtenCreate: 0,
      writtenUpdate: 0,
      skipped: 0,
      wroteRows: 0,
      durationMs,
      notes,
    }
  }
}

