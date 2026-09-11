/**
 * Reading the import preview's coverage summary off the wire, for the screen that renders it.
 *
 * 🛑 THE ONE RULE HERE IS THAT ABSENT AND COMPLETE ARE DIFFERENT ANSWERS, and collapsing them is
 * the only way this can do harm. An empty summary renders as "nothing is missing", which is a
 * claim about someone's league. A preview that simply did not carry a summary — an older
 * deployment, a shape we cannot read — has made no such claim, and the screen must stay silent
 * rather than reassure.
 *
 * `readImportCoverage` in `importCoverageSummary.ts` draws the same distinction for the persisted
 * copy and says why: a league imported before coverage was recorded has no block, and reading that
 * as "nothing came across" would hide every tab in the product. This is that rule at the network
 * boundary instead of the database one.
 *
 * ⚠ SEPARATE FROM `ImportCoverageSummary` ON PURPOSE. That type describes what the server intends
 * to send; this describes what a client may assume it received. They are the same shape today, and
 * a `satisfies`-style coupling would be wrong — the whole job of this file is to distrust the
 * payload.
 */
import { IMPORT_COVERAGE_LABELS } from './importCoverageSummary'
import type { ImportCoverageKey } from './types'

export interface PreviewCoverage {
  /** One sentence naming the PLATFORM's limitation, or null when there is nothing to say. */
  sentence: string | null
  missing: ImportCoverageKey[]
  partial: ImportCoverageKey[]
}

/**
 * Keys we hold a user-facing label for.
 *
 * ⚠ An unrecognised key is DROPPED rather than rendered raw. A new bucket added server-side would
 * otherwise reach a user as `historicalRosterSnapshots` — which reads like a fault in the product
 * rather than a description of their league.
 */
function knownCoverageKeys(raw: unknown): ImportCoverageKey[] {
  if (!Array.isArray(raw)) return []
  const out: ImportCoverageKey[] = []
  for (const key of raw) {
    if (typeof key === 'string' && key in IMPORT_COVERAGE_LABELS && !out.includes(key as ImportCoverageKey)) {
      out.push(key as ImportCoverageKey)
    }
  }
  return out
}

/** Null for anything unreadable, and null for a summary with nothing to report. Never `{}`. */
export function readPreviewCoverage(raw: unknown): PreviewCoverage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>

  const sentence =
    typeof record.sentence === 'string' && record.sentence.trim() ? record.sentence.trim() : null
  const missing = knownCoverageKeys(record.missing)
  const partial = knownCoverageKeys(record.partial)

  /*
   * A summary that reports no gaps is a real, good answer — and it is still null here, because
   * this type exists to drive a warning panel. A green "everything arrived" box on every single
   * import is noise, and noise is what teaches people to skip the one import where it matters.
   */
  if (!sentence && missing.length === 0 && partial.length === 0) return null

  return { sentence, missing, partial }
}

/** The user-facing nouns, joined. Shared so the screen never re-labels a key itself. */
export function labelCoverageKeys(keys: readonly ImportCoverageKey[]): string {
  return keys.map((key) => IMPORT_COVERAGE_LABELS[key]).join(', ')
}
