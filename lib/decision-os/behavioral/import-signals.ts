/**
 * Phase 5.2 — Import signals feeding Decision OS.
 *
 * Pure module: types + pure derivation of `ImportDataQuality` from a minimal
 * `ImportSignalsInput`. No IO, no Prisma, no DB access. The real-data-provider
 * populates the input via a Port function; unit tests can pass fixtures.
 *
 * The audit (`docs/DECISION_OS_WIRING_AUDIT.md`) identified two safely-wireable
 * signals: (A) awareness of the most recent completed import, and (B) counts of
 * persisted `ImportWarning` rows. This module encodes both as a single derived
 * shape that `LeagueBehavioralIntelligence` can carry additively.
 */

/**
 * Minimal shape the Decision OS pipeline needs to know about a league's imports.
 * All fields are optional — the resolver returns an empty shape when no imports
 * exist for the league, and pure derivation collapses that to
 * `dataQuality: undefined` so the field is absent for un-imported leagues.
 */
export interface ImportSignalsInput {
  /** Latest completed Sleeper `ImportRun.completedAt` for the league. Null when no run. */
  lastImportedAt: Date | null
  /** Count of `ImportWarning` rows for the league by severity. */
  warningCountsBySeverity: {
    error: number
    warn: number
    info: number
  }
  /**
   * True when the latest ImportRun's status is not `completed` (still `running`
   * or `failed`). Distinct from `warn`/`error` warnings, which can exist even
   * after a completed run.
   */
  latestRunIncomplete: boolean
}

/**
 * Additive `dataQuality` field surfaced on `LeagueBehavioralIntelligence`.
 * Consumers destructure defensively — the whole shape is optional.
 */
export interface ImportDataQuality {
  /** True when the latest import didn't fully complete or produced error warnings. */
  importIncomplete: boolean
  /** Count of persisted `ImportWarning` rows with severity `warn` or `error`. */
  unresolvedWarnings: number
  /** True when the league has any completed Sleeper import (basis for the signal). */
  hasRecentImport: boolean
  /** ISO 8601 timestamp of the last completed Sleeper import for the league. */
  lastImportedAt: string | null
}

/**
 * Pure derivation. Returns undefined when the league has no import history so
 * the field is absent (not `false`) on un-imported leagues — that matches the
 * audit's guidance that Decision OS should honestly say "some data is
 * incomplete" only when there's data to compare against.
 */
export function deriveImportDataQuality(
  input: ImportSignalsInput | null,
): ImportDataQuality | undefined {
  if (!input) return undefined
  if (input.lastImportedAt == null) return undefined // never imported → no signal

  const unresolvedWarnings =
    (input.warningCountsBySeverity.warn ?? 0) + (input.warningCountsBySeverity.error ?? 0)
  const importIncomplete =
    input.latestRunIncomplete || (input.warningCountsBySeverity.error ?? 0) > 0

  return {
    importIncomplete,
    unresolvedWarnings,
    hasRecentImport: true,
    lastImportedAt: input.lastImportedAt.toISOString(),
  }
}

/**
 * Wire-up A — clamp/extend a caller-provided lookback so that a recent Sleeper
 * import is never excluded from the behavioral window. Pure. Returns the same
 * `lookbackDays` when no widening is needed.
 *
 * Rationale: the audit noted that a fresh import can be ignored on the very
 * first health computation if it landed just before the lookback boundary. We
 * widen (never narrow) so nothing that used to be visible disappears.
 */
export function extendLookbackForImport(
  lookbackDays: number,
  lastImportedAt: Date | null,
  now: Date = new Date(),
): number {
  if (lastImportedAt == null) return lookbackDays
  const msSinceImport = now.getTime() - lastImportedAt.getTime()
  if (msSinceImport <= 0) return lookbackDays // future date, defensive no-op
  const daysSinceImport = Math.ceil(msSinceImport / (1000 * 60 * 60 * 24))
  return Math.max(lookbackDays, daysSinceImport)
}
