/**
 * Scoring-upgrade shadow harness — READ-ONLY.
 *
 * Purpose:
 *   Compare a candidate "upgraded" weekly fantasy-points calculation against
 *   the existing baseline value, sample-by-sample, so future scoring upgrades
 *   can be validated before they affect any user-facing surface.
 *
 * Hard guarantees (do not relax without a separate review):
 *   - Does NOT write to the database.
 *   - Does NOT emit realtime events.
 *   - Does NOT mutate any input.
 *   - Does NOT call into the canonical scoring engines; the candidate
 *     calculation is supplied by the caller as a pure function.
 *   - Default execution path is inert: when the shadow flag resolves to
 *     `enabled: false`, the candidate function is never invoked and no diffs
 *     are computed.
 *
 * This file intentionally has no Prisma, network, or filesystem dependencies.
 */

import {
  resolveScoringUpgradeShadowPlan,
  type ResolveScoringUpgradeShadowPlanInput,
  type ScoringUpgradeShadowPlan,
} from './scoring-upgrade-shadow-flag'

/** Match threshold (absolute fantasy-points delta considered equivalent). */
export const SCORING_UPGRADE_SHADOW_EPS_MATCH = 0.02
/** Warning threshold (above this is `critical`). */
export const SCORING_UPGRADE_SHADOW_EPS_WARN = 0.5

export type WeeklyScoreSample = {
  leagueId: string
  playerId: string
  season: number
  week: number
  sport: string
  /** Baseline value (e.g. read from `LeaguePlayerWeeklyScore.fantasyPts`). */
  fantasyPts: number
}

/**
 * Pure, synchronous candidate calculator. Returning `null` indicates the
 * candidate cannot score the sample (e.g. missing input); it will be flagged
 * as `missingCandidate` rather than treated as a delta of `-baseline`.
 */
export type ScoringUpgradeCandidateFn = (sample: WeeklyScoreSample) => number | null

export type ScoringUpgradeShadowSeverity = 'none' | 'info' | 'warning' | 'critical'

export type ScoringUpgradeShadowDiffRow = {
  leagueId: string
  playerId: string
  season: number
  week: number
  sport: string
  baseline: number
  candidate: number | null
  delta: number | null
  /** `true` when the absolute delta exceeds `SCORING_UPGRADE_SHADOW_EPS_MATCH`. */
  mismatched: boolean
  missingCandidate: boolean
  candidateError: string | null
}

export type ScoringUpgradeShadowTelemetryEvent =
  | 'shadow_skipped'
  | 'shadow_started'
  | 'shadow_completed'
  | 'shadow_candidate_error'

export type ScoringUpgradeShadowTelemetryPayload = {
  jobName: string
  reason?: string
  sampleCount?: number
  mismatchedCount?: number
  missingCandidateCount?: number
  candidateErrorCount?: number
  severity?: ScoringUpgradeShadowSeverity
  durationMs?: number
  error?: string
  leagueId?: string
  playerId?: string
  season?: number
  week?: number
  sport?: string
}

export type ScoringUpgradeShadowTelemetry = (
  event: ScoringUpgradeShadowTelemetryEvent,
  payload: ScoringUpgradeShadowTelemetryPayload,
) => void

export type RunScoringUpgradeShadowInput = ResolveScoringUpgradeShadowPlanInput & {
  samples: ReadonlyArray<WeeklyScoreSample>
  candidate: ScoringUpgradeCandidateFn
  /** Free-form label for structured logs. Defaults to `'scoring_upgrade_shadow'`. */
  jobName?: string
  /** Optional injection point for tests / future observability hooks. */
  telemetry?: ScoringUpgradeShadowTelemetry
  /** Injection point for tests; defaults to `Date.now`. */
  now?: () => number
}

export type ScoringUpgradeShadowResult = {
  enabled: boolean
  plan: ScoringUpgradeShadowPlan
  sampleCount: number
  evaluatedCount: number
  mismatchedCount: number
  missingCandidateCount: number
  candidateErrorCount: number
  severity: ScoringUpgradeShadowSeverity
  rows: ScoringUpgradeShadowDiffRow[]
  notes: string[]
  durationMs: number
}

function roundToCents(value: number): number {
  if (!Number.isFinite(value)) return value
  return Math.round(value * 100) / 100
}

function defaultLog(
  event: ScoringUpgradeShadowTelemetryEvent,
  payload: ScoringUpgradeShadowTelemetryPayload,
): void {
  // Structured log only; no realtime emission, no DB write.
  // Matches the shape used by lib/scoring/stat-drift-probe.ts.
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event,
      subsystem: 'scoring_upgrade_shadow',
      ...payload,
    }),
  )
}

export function computeScoringUpgradeShadowSeverity(
  rows: ReadonlyArray<ScoringUpgradeShadowDiffRow>,
): ScoringUpgradeShadowSeverity {
  let hasCritical = false
  let hasWarning = false
  let hasInfo = false

  for (const row of rows) {
    if (row.candidateError) {
      hasInfo = true
      continue
    }
    if (row.missingCandidate) {
      hasInfo = true
      continue
    }
    if (row.delta == null) continue

    const abs = Math.abs(row.delta)
    if (abs > SCORING_UPGRADE_SHADOW_EPS_WARN) {
      hasCritical = true
    } else if (abs > SCORING_UPGRADE_SHADOW_EPS_MATCH) {
      hasWarning = true
    }
  }

  if (hasCritical) return 'critical'
  if (hasWarning) return 'warning'
  if (hasInfo) return 'info'
  return 'none'
}

function emitTelemetry(
  telemetry: ScoringUpgradeShadowTelemetry | undefined,
  event: ScoringUpgradeShadowTelemetryEvent,
  payload: ScoringUpgradeShadowTelemetryPayload,
): void {
  const sink = telemetry ?? defaultLog
  try {
    sink(event, payload)
  } catch {
    // Telemetry must never break the shadow harness.
  }
}

/**
 * Run the read-only scoring-upgrade shadow harness for a batch of samples.
 *
 * When the resolved plan is not enabled, the candidate function is never
 * invoked, no rows are produced, and the result is fully inert.
 */
export function runScoringUpgradeShadow(
  input: RunScoringUpgradeShadowInput,
): ScoringUpgradeShadowResult {
  const jobName = input.jobName ?? 'scoring_upgrade_shadow'
  const now = input.now ?? Date.now
  const startedAt = now()

  const plan = resolveScoringUpgradeShadowPlan({
    mode: input.mode,
    isInternalRequest: input.isInternalRequest,
    isCanaryLeague: input.isCanaryLeague,
  })

  const sampleCount = input.samples.length

  if (!plan.enabled) {
    emitTelemetry(input.telemetry, 'shadow_skipped', {
      jobName,
      reason: plan.reason,
      sampleCount,
    })
    return {
      enabled: false,
      plan,
      sampleCount,
      evaluatedCount: 0,
      mismatchedCount: 0,
      missingCandidateCount: 0,
      candidateErrorCount: 0,
      severity: 'none',
      rows: [],
      notes: ['shadow_disabled'],
      durationMs: Math.max(0, now() - startedAt),
    }
  }

  emitTelemetry(input.telemetry, 'shadow_started', {
    jobName,
    reason: plan.reason,
    sampleCount,
  })

  const rows: ScoringUpgradeShadowDiffRow[] = []
  let mismatchedCount = 0
  let missingCandidateCount = 0
  let candidateErrorCount = 0

  for (const sample of input.samples) {
    const baseline = roundToCents(sample.fantasyPts)
    let candidateValue: number | null = null
    let candidateError: string | null = null

    try {
      const raw = input.candidate(sample)
      candidateValue = raw == null ? null : roundToCents(raw)
    } catch (err) {
      candidateError =
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'candidate_threw'
      candidateErrorCount += 1
      emitTelemetry(input.telemetry, 'shadow_candidate_error', {
        jobName,
        leagueId: sample.leagueId,
        playerId: sample.playerId,
        season: sample.season,
        week: sample.week,
        sport: sample.sport,
        error: candidateError,
      })
    }

    const missingCandidate = candidateError == null && candidateValue == null
    if (missingCandidate) missingCandidateCount += 1

    const delta =
      candidateError != null || candidateValue == null
        ? null
        : roundToCents(candidateValue - baseline)
    const mismatched = delta != null && Math.abs(delta) > SCORING_UPGRADE_SHADOW_EPS_MATCH
    if (mismatched) mismatchedCount += 1

    rows.push({
      leagueId: sample.leagueId,
      playerId: sample.playerId,
      season: sample.season,
      week: sample.week,
      sport: sample.sport,
      baseline,
      candidate: candidateValue,
      delta,
      mismatched,
      missingCandidate,
      candidateError,
    })
  }

  const severity = computeScoringUpgradeShadowSeverity(rows)
  const evaluatedCount = sampleCount - candidateErrorCount - missingCandidateCount
  const durationMs = Math.max(0, now() - startedAt)

  emitTelemetry(input.telemetry, 'shadow_completed', {
    jobName,
    reason: plan.reason,
    sampleCount,
    mismatchedCount,
    missingCandidateCount,
    candidateErrorCount,
    severity,
    durationMs,
  })

  return {
    enabled: true,
    plan,
    sampleCount,
    evaluatedCount,
    mismatchedCount,
    missingCandidateCount,
    candidateErrorCount,
    severity,
    rows,
    notes: [],
    durationMs,
  }
}
