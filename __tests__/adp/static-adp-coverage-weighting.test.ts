/**
 * Static ADP export — coverage measurement and the source-weight ordering it corrects.
 *
 * `data/nfl-adp-multiplatform.csv` supplies four of the six NFL ADP "sources" (fantrax, sleeper,
 * espn, mfl). It is a hand-placed export with no generator in this repo. The importer republished
 * it nightly under a fresh `created_at` — and weighted `fantrax` at 1.0 and `sleeper` at 0.95
 * against `ffc` at 0.9, so the stale file outvoted the only live fetch on every player it listed.
 *
 * These tests pin the two things that made that possible: the ordering, and the fact that the
 * staleness penalty must apply to the CSV columns and NOT to the live source.
 */

import { describe, expect, it } from 'vitest'

import {
  COVERAGE_MIN_PRESENT_PCT,
  STALE_STATIC_SOURCE_WEIGHT_FACTOR,
  measureStaticAdpCoverage,
  normalizeCoverageName,
  latestCompletedDraftYear,
  staticSourceWeightFactor,
} from '@/lib/adp/staticAdpCoverage'
import { STATIC_CSV_SOURCES, sourceWeight } from '@/lib/workers/adp-importer'
import { loadMultiPlatformADP } from '@/lib/multi-platform-adp'
import capitalRaw from '@/data/nfl-draft-capital.json'

const CAPITAL = capitalRaw as unknown as Array<{
  name: string
  draftRound: number
  draftYear: number
}>

describe('source weight ordering', () => {
  it('ranks the live fetch above every static CSV column, even before any decay', () => {
    const ffc = sourceWeight('ffc')
    for (const csvSource of STATIC_CSV_SOURCES) {
      expect(ffc).toBeGreaterThan(sourceWeight(csvSource))
    }
  })

  it('leaves the live source untouched by the staleness factor', () => {
    // The whole point of the factor: it targets the file, not every source.
    expect(sourceWeight('ffc', STALE_STATIC_SOURCE_WEIGHT_FACTOR)).toBe(sourceWeight('ffc', 1))
  })

  it('decays every CSV column when the export has aged out', () => {
    for (const csvSource of STATIC_CSV_SOURCES) {
      const fresh = sourceWeight(csvSource, 1)
      const stale = sourceWeight(csvSource, STALE_STATIC_SOURCE_WEIGHT_FACTOR)
      expect(stale).toBeLessThan(fresh)
      expect(stale).toBeLessThan(sourceWeight('ffc'))
    }
  })

  it('does not decay a source that is not CSV-backed', () => {
    expect(sourceWeight('ai_adp', STALE_STATIC_SOURCE_WEIGHT_FACTOR)).toBe(sourceWeight('ai_adp', 1))
  })
})

describe('coverage measurement', () => {
  const now = new Date('2026-08-30T00:00:00Z')
  const expectedClass = latestCompletedDraftYear(now)
  const cohort = CAPITAL.filter((r) => r.draftYear === expectedClass && r.draftRound <= 2)

  it('dates the file from the newest draft class, not from a clock or an mtime', () => {
    // June cutover: a run in May must not demand that year's class yet.
    expect(latestCompletedDraftYear(new Date('2026-05-31T00:00:00Z'))).toBe(2025)
    expect(latestCompletedDraftYear(new Date('2026-06-01T00:00:00Z'))).toBe(2026)
  })

  it('reports a file listing the expected class as covering it', () => {
    const names = cohort.map((r) => r.name)
    const coverage = measureStaticAdpCoverage(names, now)
    if (coverage.indeterminate) return // reference itself behind; its own check reports that
    expect(coverage.presentPct).toBeGreaterThanOrEqual(COVERAGE_MIN_PRESENT_PCT)
    expect(coverage.coversExpectedClass).toBe(true)
    expect(staticSourceWeightFactor(coverage)).toBe(1)
  })

  it('reports a file missing the expected class as not covering it', () => {
    const coverage = measureStaticAdpCoverage(['Some Veteran', 'Another Veteran'], now)
    if (coverage.indeterminate) return
    expect(coverage.coversExpectedClass).toBe(false)
    expect(staticSourceWeightFactor(coverage)).toBe(STALE_STATIC_SOURCE_WEIGHT_FACTOR)
  })

  it('normalizes punctuation the same way on both sides of the comparison', () => {
    expect(normalizeCoverageName("Ja'Marr Chase")).toBe('jamarr chase')
    expect(normalizeCoverageName('T.J. Watt')).toBe('tj watt')
  })
})

describe('the committed export, as it actually stands', () => {
  /*
   * Deliberately asserts CONSISTENCY, not a verdict. Hardcoding "the CSV is stale" would make this
   * test fail the day someone finally refreshes the file — punishing the fix.
   */
  it('produces a factor that agrees with its own coverage verdict', () => {
    const names = loadMultiPlatformADP().map((p) => p.name)
    expect(names.length).toBeGreaterThan(0)
    const coverage = measureStaticAdpCoverage(names)
    expect(staticSourceWeightFactor(coverage)).toBe(
      coverage.coversExpectedClass ? 1 : STALE_STATIC_SOURCE_WEIGHT_FACTOR,
    )
    console.log(
      `[static ADP export] class ${coverage.expectedClass}: ${coverage.present}/${coverage.cohortSize}` +
        ` (${coverage.presentPct}%) -> ${coverage.coversExpectedClass ? 'current' : 'AGED OUT'}`,
    )
  })
})
