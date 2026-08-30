/**
 * How current is `data/nfl-adp-multiplatform.csv`, measured from its own CONTENT.
 *
 * WHY THIS EXISTS. Four of the six NFL ADP sources (`fantrax`, `sleeper`, `espn`, `mfl`) are not
 * provider calls at all — they are COLUMNS of that one committed CSV, read through
 * `loadMultiPlatformADP()`. Only `ffc` is a live fetch. The file is a hand-placed export with no
 * generator in this repo, and on 2026-08-28 it was last changed 2026-03-08, before that April's
 * draft. `lib/workers/adp-importer.ts` republished it nightly under a fresh `created_at`, so every
 * freshness monitor read green.
 *
 * 🛑 AND THE SOURCE WEIGHTS WERE THE WRONG WAY ROUND. `fantrax` scored 1.0 and `sleeper` 0.95 —
 * both stale columns — while `ffc`, the ONLY source actually fetched that morning, scored 0.9. The
 * consensus mean therefore let a six-month-old file outvote live data on every player it listed.
 *
 * ⚠ FILE MTIME CANNOT ANSWER THIS AND MUST NOT BE USED. A fresh clone or a CI checkout stamps
 * every file with the checkout time, so mtime would report a years-old export as minutes old —
 * green for the worst possible reason. The date has to come from what the file SAYS.
 *
 * An ADP board for season Y lists the players who entered the league in Y, so the newest class in
 * `data/nfl-draft-capital.json` dates it. That is the same signal
 * `scripts/check-static-data-freshness.mjs` already uses, deliberately reused rather than
 * redefined — two definitions of "is this file current" would drift, and the drift would be
 * invisible because both would keep returning a number.
 *
 * Measured there, rounds 1-2 defenders present by class: 2023 93%, 2024 86%, 2025 90%, 2026 0%.
 * A present class lands at 86-93%; a missing one is 0%. The 40% threshold sits far below the
 * observed floor and far above zero, so ordinary variation — a deep pick with no ADP, a name
 * spelled differently — cannot trip it.
 *
 * This module reports; it does not refresh. Only a human replacing the export can do that.
 */

import capitalRaw from '@/data/nfl-draft-capital.json'

interface CapitalRow {
  name: string
  draftRound: number
  draftYear: number
}

const CAPITAL = capitalRaw as unknown as CapitalRow[]

/**
 * Matches `normName` in `scripts/check-static-data-freshness.mjs`. Letters and spaces only, so
 * `T.J. Watt` and `Ja'Marr Chase` reduce the same way on both sides of the comparison.
 */
export function normalizeCoverageName(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The NFL draft runs in late April. Treating a class as "expected" only from 1 June leaves a
 * month of slack, so a run on 1 May does not penalise a file while the release is still being
 * published. Same rule as the freshness script's `latestCompletedDraft`.
 */
export function latestCompletedDraftYear(now: Date): number {
  const y = now.getUTCFullYear()
  return now.getUTCMonth() >= 5 ? y : y - 1
}

/** Below this percentage the file is judged not to list the class at all. */
export const COVERAGE_MIN_PRESENT_PCT = 40

export interface StaticAdpCoverage {
  /** The class the file is being asked to cover. */
  expectedClass: number
  cohortSize: number
  present: number
  presentPct: number
  coversExpectedClass: boolean
  /** Set when the reference table is itself behind and cannot date anything. */
  indeterminate: boolean
}

/**
 * Pure measurement. `names` is every player name the CSV lists.
 *
 * ⚠ AN INDETERMINATE RESULT IS NOT A FAILING ONE. If `nfl-draft-capital.json` is itself stale it
 * cannot date the CSV, and guessing "stale" there would penalise the ADP file for a fault in a
 * different artifact. `coversExpectedClass` stays true so weighting is unchanged, and
 * `indeterminate` says why — the freshness script reports the reference's own staleness.
 */
export function measureStaticAdpCoverage(
  names: readonly string[],
  now: Date = new Date(),
): StaticAdpCoverage {
  const expectedClass = latestCompletedDraftYear(now)
  const newestClass = CAPITAL.reduce(
    (max, r) => (Number.isFinite(r.draftYear) && r.draftYear > max ? r.draftYear : max),
    0,
  )

  if (newestClass < expectedClass) {
    return {
      expectedClass,
      cohortSize: 0,
      present: 0,
      presentPct: 0,
      coversExpectedClass: true,
      indeterminate: true,
    }
  }

  const cohort = CAPITAL.filter((r) => r.draftYear === newestClass && r.draftRound <= 2)
  if (cohort.length === 0) {
    return {
      expectedClass,
      cohortSize: 0,
      present: 0,
      presentPct: 0,
      coversExpectedClass: true,
      indeterminate: true,
    }
  }

  const haystack = new Set(names.map(normalizeCoverageName))
  const present = cohort.filter((r) => haystack.has(normalizeCoverageName(r.name))).length
  const presentPct = (present / cohort.length) * 100

  return {
    expectedClass,
    cohortSize: cohort.length,
    present,
    presentPct: Number(presentPct.toFixed(1)),
    coversExpectedClass: presentPct >= COVERAGE_MIN_PRESENT_PCT,
    indeterminate: false,
  }
}

/**
 * Multiplier applied to the weight of every CSV-backed source when the file has aged out.
 *
 * 0.5 is chosen so the four static sources fall BELOW the live `ffc` weight individually
 * (1.0 -> 0.5, 0.95 -> 0.475, 0.9 -> 0.45, 0.88 -> 0.44), which is the ordering error this
 * corrects. It deliberately does not zero them: for a veteran a six-month-old ADP is roughly
 * right, and it is the only cross-platform corroboration we hold. The players it is WRONG about
 * — that year's rookies — are absent from the file entirely, so no weight can rescue them and
 * none needs to be withheld.
 *
 * The factor lifts on its own the moment a fresh export is committed. Nothing has to remember
 * to undo it.
 */
export const STALE_STATIC_SOURCE_WEIGHT_FACTOR = 0.5

export function staticSourceWeightFactor(coverage: StaticAdpCoverage): number {
  return coverage.coversExpectedClass ? 1 : STALE_STATIC_SOURCE_WEIGHT_FACTOR
}
