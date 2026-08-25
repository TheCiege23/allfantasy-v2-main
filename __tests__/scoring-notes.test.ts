import { describe, expect, it } from 'vitest'

import { buildProjectionQuestion, describeScoringDifferences } from '@/lib/core-app/scoringNotes'

/**
 * The screen shows two projections for the same player and claims they differ
 * because of the league's rules. These notes are that claim's evidence, so they
 * have to be read off the settings and never inferred.
 */

describe('describeScoringDifferences', () => {
  it('says nothing when the league really is standard PPR', () => {
    // Silence is the correct answer here. Manufacturing a "difference" for a
    // league that has none would explain a gap that does not exist.
    expect(describeScoringDifferences({ rec: 1, pass_td: 4, pass_int: -2 })).toEqual([])
  })

  it('names TE premium, the most common reason a tight end diverges', () => {
    const notes = describeScoringDifferences({ rec: 1, bonus_rec_te: 0.5 })
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('Tight ends')
    expect(notes[0]).toContain('0.5')
  })

  it('calls standard scoring what it is rather than "0 per reception"', () => {
    const notes = describeScoringDifferences({ rec: 0 })
    expect(notes[0]).toContain('standard scoring, not PPR')
  })

  it('reports half PPR with its actual number', () => {
    expect(describeScoringDifferences({ rec: 0.5 })[0]).toContain('0.5')
  })

  it('flags six-point passing touchdowns', () => {
    expect(describeScoringDifferences({ pass_td: 6 })[0]).toContain('6')
  })

  it('flags IDP, where the generic number is not merely different but meaningless', () => {
    // The vendor's PPR figure contains no defensive scoring at all, so for a
    // linebacker the standard column is not a worse estimate — it is not an
    // estimate of anything.
    const notes = describeScoringDifferences({ rec: 1, idp_tkl_solo: 1, idp_sack: 4 })
    expect(notes.some((n) => n.includes('defensive'))).toBe(true)
  })

  it('⚠ says nothing about a key the league did not record', () => {
    /*
     * An absent key means the league never wrote it down, NOT that the league
     * uses the default. Asserting a default here would put a sentence on screen
     * about a rule we never read.
     */
    expect(describeScoringDifferences({ rec: 1 })).toEqual([])
  })

  it('handles string numbers, which is how some imports store them', () => {
    expect(describeScoringDifferences({ rec: '0.5' })[0]).toContain('0.5')
  })

  it('survives junk without throwing', () => {
    expect(describeScoringDifferences(null)).toEqual([])
    expect(describeScoringDifferences(undefined)).toEqual([])
    expect(describeScoringDifferences({ rec: 'not a number' })).toEqual([])
  })

  it('trims trailing zeroes so the prose reads like prose', () => {
    expect(describeScoringDifferences({ pass_td: 6.0 })[0]).toContain('worth 6,')
  })
})

describe('buildProjectionQuestion', () => {
  it('is phrased as the manager asking, because it lands in their composer', () => {
    const q = buildProjectionQuestion('Bla bla bla', 1)
    expect(q).toContain('Bla bla bla')
    expect(q).toContain('week 1')
    expect(q.startsWith('Why is')).toBe(true)
  })

  it('drops the week rather than inventing one', () => {
    expect(buildProjectionQuestion('Bla bla bla', null)).not.toContain('week')
  })
})
