import { describe, expect, it } from 'vitest'

import {
  labelCoverageKeys,
  readPreviewCoverage,
} from '@/lib/league-import/previewCoverageView'
import { IMPORT_COVERAGE_LABELS } from '@/lib/league-import/importCoverageSummary'

/**
 * 🛑 EVERY TEST HERE IS ABOUT ONE DISTINCTION: "we don't know" is not "nothing is missing".
 *
 * The import screen shows this before the commit button, so a wrong `null` costs a warning
 * somebody should have seen, and a wrong `{}` renders as a reassurance nobody earned. The second
 * is worse: it is the product telling someone their league imported completely, on the strength
 * of a field that was not there.
 */
describe('readPreviewCoverage', () => {
  it('reads a real summary, keeping the sentence and both gap lists', () => {
    const out = readPreviewCoverage({
      sentence: "Fleaflicker doesn't publish trade history or past seasons.",
      missing: ['tradeHistory', 'previousSeasons'],
      partial: ['scoringSettings'],
      capabilities: { trades: false },
      hasGaps: true,
    })

    expect(out).toEqual({
      sentence: "Fleaflicker doesn't publish trade history or past seasons.",
      missing: ['tradeHistory', 'previousSeasons'],
      partial: ['scoringSettings'],
    })
  })

  it('🛑 returns null for a MISSING summary rather than an empty one', () => {
    // A preview from a build that predates `coverageNarrative`. The screen must stay silent.
    for (const absent of [undefined, null, '', 0, false]) {
      expect(readPreviewCoverage(absent)).toBeNull()
    }
  })

  it('🛑 returns null for a summary reporting NO gaps — silence, not a green panel', () => {
    /*
     * This is a real, good answer from the server, and it still renders nothing. A success box on
     * every import is noise, and noise is what teaches people to skip the one import where the
     * warning mattered.
     */
    expect(readPreviewCoverage({ sentence: null, missing: [], partial: [], hasGaps: false })).toBeNull()
  })

  it('does not mistake an array or a string for a summary', () => {
    expect(readPreviewCoverage(['tradeHistory'])).toBeNull()
    expect(readPreviewCoverage('tradeHistory')).toBeNull()
  })

  it('drops a key it has no label for instead of showing the raw field name', () => {
    /*
     * A bucket added server-side and not yet labelled here would otherwise reach a user as
     * `historicalRosterSnapshots`, which reads as a fault in the product rather than a
     * description of their league.
     */
    const out = readPreviewCoverage({
      sentence: null,
      missing: ['tradeHistory', 'somethingNewServerSide', 42, null],
      partial: [],
    })
    expect(out?.missing).toEqual(['tradeHistory'])
  })

  it('survives gap lists that are not arrays at all', () => {
    const out = readPreviewCoverage({ sentence: 'Something is missing.', missing: 'tradeHistory', partial: null })
    expect(out).toEqual({ sentence: 'Something is missing.', missing: [], partial: [] })
  })

  it('treats a blank or whitespace sentence as no sentence', () => {
    // A rendered empty paragraph is worse than no paragraph — it reads as a failed load.
    expect(readPreviewCoverage({ sentence: '   ', missing: [], partial: [] })).toBeNull()
    expect(readPreviewCoverage({ sentence: '  ', missing: ['tradeHistory'], partial: [] })).toEqual({
      sentence: null,
      missing: ['tradeHistory'],
      partial: [],
    })
  })

  it('de-duplicates a key the server repeated', () => {
    const out = readPreviewCoverage({
      sentence: null,
      missing: ['tradeHistory', 'tradeHistory'],
      partial: [],
    })
    // "trade history, trade history" is not a sentence anyone should read.
    expect(out?.missing).toEqual(['tradeHistory'])
  })
})

describe('labelCoverageKeys', () => {
  it('renders the shared user-facing nouns, not the internal keys', () => {
    expect(labelCoverageKeys(['tradeHistory', 'previousSeasons'])).toBe('trade history, past seasons')
  })

  it('🛑 uses the SAME label map the post-import banner uses', () => {
    /*
     * The screen must never re-label a key itself. `ImportedLeaguePreviewBuilder` holds a second,
     * already-drifted copy of these labels ("Draft history" vs "draft results"); rendering from
     * that one would make the sentence before the commit disagree with the banner after it.
     */
    expect(labelCoverageKeys(['draftHistory'])).toBe(IMPORT_COVERAGE_LABELS.draftHistory)
    expect(labelCoverageKeys(['playerIdentityMap'])).toBe(IMPORT_COVERAGE_LABELS.playerIdentityMap)
  })

  it('renders nothing for an empty list', () => {
    expect(labelCoverageKeys([])).toBe('')
  })
})
