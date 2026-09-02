import { describe, expect, it } from 'vitest'

import {
  IMPORT_COVERAGE_SETTINGS_KEY,
  readImportCoverage,
  resolveImportCoverageSummary,
  summarizeImportCoverage,
  UNKNOWN_IMPORT_COVERAGE,
} from '@/lib/league-import/importCoverageSummary'
import type { ImportCoverage } from '@/lib/league-import/types'

/** A coverage block with every bucket full, so each test can knock out just what it means to. */
function fullCoverage(overrides: Partial<ImportCoverage> = {}): ImportCoverage {
  return {
    leagueSettings: { state: 'full' },
    currentRosters: { state: 'full' },
    historicalRosterSnapshots: { state: 'full' },
    scoringSettings: { state: 'full' },
    playoffSettings: { state: 'full' },
    currentStandings: { state: 'full' },
    currentSchedule: { state: 'full' },
    draftHistory: { state: 'full' },
    tradeHistory: { state: 'full' },
    previousSeasons: { state: 'full' },
    playerIdentityMap: { state: 'full' },
    ...overrides,
  }
}

describe('summarizeImportCoverage', () => {
  it('says nothing when everything a user cares about arrived', () => {
    const summary = summarizeImportCoverage(fullCoverage(), 'sleeper')
    expect(summary.sentence).toBeNull()
    expect(summary.hasGaps).toBe(false)
    expect(summary.missing).toEqual([])
    expect(Object.values(summary.capabilities).every(Boolean)).toBe(true)
  })

  /*
   * The Fleaflicker shape, which is the reason this module exists: two API calls, so
   * scoring, schedule, draft, trades and past seasons are all genuinely absent.
   */
  it('names the platform, not us, when a provider does not publish something', () => {
    const summary = summarizeImportCoverage(
      fullCoverage({
        scoringSettings: { state: 'missing' },
        currentSchedule: { state: 'missing' },
        draftHistory: { state: 'missing' },
        tradeHistory: { state: 'missing' },
        previousSeasons: { state: 'missing' },
        historicalRosterSnapshots: { state: 'missing' },
      }),
      'fleaflicker',
    )

    expect(summary.sentence).toContain('Fleaflicker')
    expect(summary.sentence).toContain("doesn't publish")
    // The user-facing nouns, not the internal keys.
    expect(summary.sentence).toContain('scoring rules')
    expect(summary.sentence).toContain('trade history')
    // Read as a sentence, not a comma-splice list.
    expect(summary.sentence).toMatch(/ and past seasons/)
  })

  it('turns missing buckets into the tabs a league should not be offered', () => {
    const summary = summarizeImportCoverage(
      fullCoverage({ tradeHistory: { state: 'missing' }, draftHistory: { state: 'missing' } }),
      'fleaflicker',
    )
    expect(summary.capabilities.trades).toBe(false)
    expect(summary.capabilities.draft).toBe(false)
    // Untouched buckets must not be collateral damage.
    expect(summary.capabilities.rosters).toBe(true)
    expect(summary.capabilities.standings).toBe(true)
  })

  it('treats partial as usable — a capped trade list is still a trade list', () => {
    const summary = summarizeImportCoverage(
      fullCoverage({ tradeHistory: { state: 'partial', note: 'capped at 100' } }),
      'yahoo',
    )
    expect(summary.capabilities.trades).toBe(true)
    expect(summary.partial).toContain('tradeHistory')
    expect(summary.sentence).toContain('incomplete')
  })

  /*
   * History has two possible sources and either is enough. Requiring both would hide the
   * History tab on a provider that exposes prior seasons but no per-season roster snapshots.
   */
  it('keeps history when only one of its two signals is present', () => {
    expect(
      summarizeImportCoverage(
        fullCoverage({ historicalRosterSnapshots: { state: 'missing' } }),
        'espn',
      ).capabilities.history,
    ).toBe(true)

    expect(
      summarizeImportCoverage(
        fullCoverage({
          historicalRosterSnapshots: { state: 'missing' },
          previousSeasons: { state: 'missing' },
        }),
        'espn',
      ).capabilities.history,
    ).toBe(false)
  })

  /*
   * Internal plumbing must never reach the banner. A user cannot act on "player matching",
   * and listing it is how a useful notice becomes noise that gets dismissed unread.
   */
  it('does not report internal buckets to the user', () => {
    const summary = summarizeImportCoverage(
      fullCoverage({ playerIdentityMap: { state: 'missing' } }),
      'sleeper',
    )
    expect(summary.sentence).toBeNull()
    expect(summary.missing).not.toContain('playerIdentityMap')
  })
})

describe('readImportCoverage', () => {
  it('reads back what the commit path writes', () => {
    const coverage = fullCoverage()
    expect(readImportCoverage({ [IMPORT_COVERAGE_SETTINGS_KEY]: coverage })).toEqual(coverage)
  })

  it.each([
    ['null settings', null],
    ['a string', 'nope'],
    ['an array', []],
    ['settings with no coverage key', { foo: 1 }],
    ['a coverage value that is not an object', { [IMPORT_COVERAGE_SETTINGS_KEY]: 'yes' }],
    ['a coverage object missing its buckets', { [IMPORT_COVERAGE_SETTINGS_KEY]: { nope: true } }],
  ])('returns null for %s', (_label, settings) => {
    expect(readImportCoverage(settings)).toBeNull()
  })
})

describe('resolveImportCoverageSummary', () => {
  /*
   * 🛑 THE REGRESSION THIS FILE EXISTS TO PREVENT. Every league imported before coverage
   * was persisted has no block. Reading that as "nothing came across" would strip every
   * tab off every existing league in the product, and show all of them a banner about a
   * problem they do not have. Absence is not evidence.
   */
  it('shows everything and says nothing for a league with no coverage block', () => {
    const summary = resolveImportCoverageSummary({ settings: { other: true }, platform: 'sleeper' })
    expect(summary).toEqual(UNKNOWN_IMPORT_COVERAGE)
    expect(summary.sentence).toBeNull()
    expect(Object.values(summary.capabilities).every(Boolean)).toBe(true)
  })

  it('shows everything for a native league that was never imported', () => {
    expect(resolveImportCoverageSummary({ settings: {}, platform: null })).toEqual(
      UNKNOWN_IMPORT_COVERAGE,
    )
  })

  it('applies the block when one is present', () => {
    const summary = resolveImportCoverageSummary({
      settings: {
        [IMPORT_COVERAGE_SETTINGS_KEY]: fullCoverage({ tradeHistory: { state: 'missing' } }),
      },
      platform: 'Fleaflicker',
    })
    expect(summary.capabilities.trades).toBe(false)
    expect(summary.sentence).toContain('Fleaflicker')
  })
})
