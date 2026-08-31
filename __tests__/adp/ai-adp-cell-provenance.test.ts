/**
 * The AI ADP cell must not present a projection with the authority of a measurement.
 *
 * lib/adp/crossSizeAdp.ts fills league sizes we have never seen a draft at, by normalising picks
 * from other sizes to rounds and projecting them in. That is exact arithmetic and it is the reason
 * a 14-team league sees 421 players instead of em-dashes — but it still describes drafts that
 * happened somewhere else. A projected number rendered identically to a measured one is the
 * honest-degradation failure this codebase names elsewhere: an estimate wearing an observation's
 * clothes.
 *
 * These tests pin the words, because the words are the entire safeguard. There is no other signal
 * distinguishing the two in the cell besides the marker and this tooltip.
 */

import { describe, expect, it } from 'vitest'

import { aiAdpCellTitle } from '@/lib/draft-room/adpReadinessCopy'

describe('a measured value reads as measured', () => {
  it('describes real drafts and never says projected or estimated', () => {
    const t = aiAdpCellTitle({ hasValue: true, sampleSize: 391, source: 'exact' })
    expect(t).toContain('Sample size: 391')
    expect(t.toLowerCase()).not.toContain('projected')
    expect(t.toLowerCase()).not.toContain('estimated')
  })

  it('still flags a thin exact sample', () => {
    const t = aiAdpCellTitle({ hasValue: true, sampleSize: 3, lowSample: true, source: 'exact' })
    expect(t).toContain('Low sample')
  })

  it('treats a missing source as exact rather than as a projection', () => {
    // Older callers pass no source. Defaulting to "projected" would slander measured data.
    const t = aiAdpCellTitle({ hasValue: true, sampleSize: 50 })
    expect(t.toLowerCase()).not.toContain('projected')
  })
})

describe('a projected value says so, unmissably', () => {
  const projected = aiAdpCellTitle({
    hasValue: true,
    sampleSize: 1240,
    source: 'cross_size',
    contributingTeamCounts: [10, 12, 14],
  })

  it('uses the word estimated and the word projected', () => {
    expect(projected.toLowerCase()).toContain('estimated')
    expect(projected.toLowerCase()).toContain('projected')
  })

  it('names the league sizes it drew on', () => {
    expect(projected).toContain('10, 12, 14-team drafts')
  })

  it('states plainly that there are no drafts at this size', () => {
    expect(projected).toContain('No drafts at your exact size yet')
  })

  it('does NOT call the number a sample size', () => {
    /*
     * "Sample size: 1240" would imply 1,240 observations of THIS league size. They are picks from
     * other sizes. The wording is deliberately different, and that difference is the point.
     */
    expect(projected).not.toContain('Sample size')
    expect(projected).toContain('Picks behind it: 1240')
  })

  it('degrades honestly when the contributing sizes are unknown', () => {
    const t = aiAdpCellTitle({ hasValue: true, source: 'cross_size', contributingTeamCounts: null })
    expect(t).toContain('Projected from drafts at other league sizes')
    expect(t).not.toContain('undefined')
    expect(t).not.toContain('NaN')
  })

  it('drops non-finite sizes rather than rendering NaN at a manager', () => {
    const t = aiAdpCellTitle({
      hasValue: true,
      source: 'cross_size',
      contributingTeamCounts: [12, Number.NaN, 14],
    })
    expect(t).toContain('12, 14-team drafts')
    expect(t).not.toContain('NaN')
  })
})

describe('no value at all', () => {
  it('says there is not enough data, and does not claim a projection', () => {
    const t = aiAdpCellTitle({ hasValue: false, source: 'cross_size' })
    expect(t.toLowerCase()).toContain('not enough')
    expect(t.toLowerCase()).not.toContain('projected')
  })
})

describe('the two tooltips are actually different', () => {
  it('a projected and a measured value never produce the same string', () => {
    // The whole safeguard is that these read differently. If they ever converge, it is gone.
    const exact = aiAdpCellTitle({ hasValue: true, sampleSize: 100, source: 'exact' })
    const cross = aiAdpCellTitle({
      hasValue: true,
      sampleSize: 100,
      source: 'cross_size',
      contributingTeamCounts: [12],
    })
    expect(cross).not.toBe(exact)
  })
})
