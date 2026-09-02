/**
 * What an import actually brought across, in terms the product can act on.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────────
 *
 * Every provider adapter already fills an eleven-bucket `ImportCoverage` block, each
 * bucket carrying a state, a count and a human-readable note. `ImportedLeaguePreviewBuilder`
 * already reduces it to capability flags. And then the UI rendered none of it and the
 * commit path did not even persist it — so the single best answer to "what did we
 * actually get?" was computed on every import and thrown away at the last step.
 *
 * The consequence was a product that could not tell the difference between a ten-year
 * Sleeper dynasty and a Fleaflicker league with no scoring, no schedule, no draft, no
 * trades and no history. Both said "Imported", both got the same tabs, and one of them
 * led to an empty screen with no explanation.
 *
 * This module is the shared derivation. One implementation, used by the banner and by
 * the nav gating, so the sentence a user reads and the tabs they are given can never
 * disagree — two copies of this rule would drift within a release.
 *
 * ⚠ THE LIMIT IS THE PLATFORM'S, AND THE COPY MUST SAY SO. "We couldn't get your trade
 * history" reads as our failure; "Fleaflicker doesn't publish trade history" is the truth
 * and is the only version a user can do anything with (switch platform, or stop looking).
 * Every sentence built here names the provider.
 */

import type { ImportCoverage, ImportCoverageKey, ImportCoverageState, ImportProvider } from './types'
import { getImportProviderLabel } from './provider-ui-config'

/** Where the persisted copy lives inside `League.settings`. */
export const IMPORT_COVERAGE_SETTINGS_KEY = 'import_coverage'

/**
 * What each bucket is called in front of a user.
 *
 * Deliberately plain nouns, not the internal camelCase keys — a person manages
 * "past seasons", not `previousSeasons`.
 */
export const IMPORT_COVERAGE_LABELS: Record<ImportCoverageKey, string> = {
  leagueSettings: 'league settings',
  currentRosters: 'rosters',
  historicalRosterSnapshots: 'past rosters',
  scoringSettings: 'scoring rules',
  playoffSettings: 'playoff settings',
  currentStandings: 'standings',
  currentSchedule: 'schedule',
  draftHistory: 'draft results',
  tradeHistory: 'trade history',
  previousSeasons: 'past seasons',
  playerIdentityMap: 'player matching',
}

/**
 * Buckets worth interrupting someone about when they are missing.
 *
 * ⚠ NOT EVERY MISSING BUCKET DESERVES A BANNER. `playerIdentityMap` and
 * `historicalRosterSnapshots` are internal plumbing — a user cannot act on either, and
 * listing them turns a useful notice into noise that gets dismissed without reading.
 * The rule for inclusion is: does a screen the user might open depend on it?
 */
const USER_FACING_KEYS: readonly ImportCoverageKey[] = [
  'currentRosters',
  'scoringSettings',
  'currentSchedule',
  'currentStandings',
  'draftHistory',
  'tradeHistory',
  'previousSeasons',
]

/**
 * Which league surfaces each bucket makes possible.
 *
 * This is the contract the nav gating reads. A `false` here removes a tab rather than
 * letting someone open it and find nothing — per the product decision that an unusable
 * tab is worse than an absent one.
 */
export interface ImportCapabilityFlags {
  rosters: boolean
  scoring: boolean
  matchups: boolean
  standings: boolean
  draft: boolean
  trades: boolean
  history: boolean
}

export interface ImportCoverageSummary {
  /** What the league can actually show. */
  capabilities: ImportCapabilityFlags
  /** User-facing buckets the provider returned nothing for. */
  missing: ImportCoverageKey[]
  /** User-facing buckets that came across incomplete. */
  partial: ImportCoverageKey[]
  /**
   * One sentence for the dashboard banner, or `null` when everything a user cares
   * about arrived — in which case there is nothing to say and nothing should be shown.
   */
  sentence: string | null
  /** True when at least one user-facing bucket is missing or partial. */
  hasGaps: boolean
}

function stateOf(coverage: ImportCoverage, key: ImportCoverageKey): ImportCoverageState {
  return coverage[key]?.state ?? 'missing'
}

/** Joins a list the way a person would say it: "a, b and c". */
function toProse(parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * Read a persisted coverage block back off `League.settings`.
 *
 * ⚠ RETURNS `null` RATHER THAN AN EMPTY COVERAGE FOR A LEAGUE THAT HAS NONE, and the
 * distinction is load-bearing. Every league imported before this was persisted has no
 * block, and treating that as "nothing came across" would hide every tab on every
 * existing league in the product. Absent means "we don't know", and the caller must
 * fall back to showing everything.
 */
export function readImportCoverage(settings: unknown): ImportCoverage | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const raw = (settings as Record<string, unknown>)[IMPORT_COVERAGE_SETTINGS_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  /* One required key is enough of a shape check: this is our own write, not user input,
     and a stricter validation would reject a block that gained a bucket. */
  if (!('currentRosters' in (raw as Record<string, unknown>))) return null
  return raw as ImportCoverage
}

/**
 * Everything the product needs from a coverage block.
 *
 * `provider` is required because every sentence names it — see the note at the top of
 * this file about whose limitation it is.
 */
export function summarizeImportCoverage(
  coverage: ImportCoverage,
  provider: ImportProvider,
): ImportCoverageSummary {
  const missing: ImportCoverageKey[] = []
  const partial: ImportCoverageKey[] = []

  for (const key of USER_FACING_KEYS) {
    const state = stateOf(coverage, key)
    if (state === 'missing') missing.push(key)
    else if (state === 'partial') partial.push(key)
  }

  const capabilities: ImportCapabilityFlags = {
    rosters: stateOf(coverage, 'currentRosters') !== 'missing',
    scoring: stateOf(coverage, 'scoringSettings') !== 'missing',
    matchups: stateOf(coverage, 'currentSchedule') !== 'missing',
    standings: stateOf(coverage, 'currentStandings') !== 'missing',
    draft: stateOf(coverage, 'draftHistory') !== 'missing',
    trades: stateOf(coverage, 'tradeHistory') !== 'missing',
    /*
     * Either signal counts. A provider can expose prior seasons without per-season
     * roster snapshots (and vice versa); requiring both would hide the History tab on
     * leagues that have real history to show.
     */
    history:
      stateOf(coverage, 'previousSeasons') !== 'missing' ||
      stateOf(coverage, 'historicalRosterSnapshots') !== 'missing',
  }

  const label = getImportProviderLabel(provider)
  let sentence: string | null = null

  if (missing.length > 0) {
    const missingProse = toProse(missing.map((key) => IMPORT_COVERAGE_LABELS[key]))
    sentence = `${label} doesn't publish ${missingProse}, so those aren't available for this league.`
    if (partial.length > 0) {
      const partialProse = toProse(partial.map((key) => IMPORT_COVERAGE_LABELS[key]))
      sentence += ` ${partialProse.charAt(0).toUpperCase()}${partialProse.slice(1)} came across incomplete.`
    }
  } else if (partial.length > 0) {
    const partialProse = toProse(partial.map((key) => IMPORT_COVERAGE_LABELS[key]))
    sentence = `Imported from ${label}. ${partialProse.charAt(0).toUpperCase()}${partialProse.slice(1)} came across incomplete.`
  }

  return {
    capabilities,
    missing,
    partial,
    sentence,
    hasGaps: missing.length > 0 || partial.length > 0,
  }
}

/**
 * What a league should show when we have no coverage block for it.
 *
 * ⚠ EVERYTHING ON, NO BANNER. Applied to the leagues imported before coverage was
 * persisted — which is all of them at the time this shipped. Defaulting to "off" would
 * strip working tabs off every existing league in the product on the strength of a
 * missing field, and defaulting to a banner would tell every one of those users that
 * something was wrong when nothing is. Absence is not evidence.
 */
export const UNKNOWN_IMPORT_COVERAGE: ImportCoverageSummary = {
  capabilities: {
    rosters: true,
    scoring: true,
    matchups: true,
    standings: true,
    draft: true,
    trades: true,
    history: true,
  },
  missing: [],
  partial: [],
  sentence: null,
  hasGaps: false,
}

/**
 * The one call a surface should make: settings in, summary out, never throws.
 *
 * A native (non-imported) league has no provider and no coverage — it gets the
 * everything-on default, which is correct: nothing about it was limited by an import.
 */
export function resolveImportCoverageSummary(args: {
  settings: unknown
  platform: string | null | undefined
}): ImportCoverageSummary {
  const coverage = readImportCoverage(args.settings)
  if (!coverage) return UNKNOWN_IMPORT_COVERAGE
  const provider = String(args.platform ?? '').toLowerCase() as ImportProvider
  if (!provider) return UNKNOWN_IMPORT_COVERAGE
  return summarizeImportCoverage(coverage, provider)
}
