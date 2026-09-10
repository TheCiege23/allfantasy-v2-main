/**
 * The Scout → trade-pitch angle.
 *
 * `scoutAngle` turns a manager's psychological profile into how to open with them. Most of what
 * it must get right is what it declines to say, so most of what follows asserts silence.
 *
 * ⚠ THE RISK THIS MODULE CARRIES IS NOT A WRONG SENTENCE, IT IS A CONFIDENT ONE. Every line it
 * emits is advice about a real, named person in the reader's league. A rule that fires on thin
 * evidence does not read as thin — it reads as a character assessment.
 */

import { describe, expect, it } from 'vitest'

import { scoutAngle, type AngleScores } from '@/lib/core-app/scoutAngle'

const NO_SCORES: AngleScores = {
  aggressionScore: null,
  activityScore: null,
  tradeFrequencyScore: null,
  waiverFocusScore: null,
  riskToleranceScore: null,
}

describe('it refuses to draw an angle it has not earned', () => {
  it('says nothing when no dimension clears the evidence floor', () => {
    /*
     * The load-bearing case. A profile can carry labels while every dimension sits below its
     * floor — the engine has explicitly declined to stand behind those readings, and dressing
     * them up as tactical advice would launder a refusal into a recommendation.
     */
    const a = scoutAngle({
      labels: ['win-now', 'trade-heavy'],
      scores: NO_SCORES,
      anySufficient: false,
    })
    expect(a.approach).toBeNull()
    expect(a.avoid).toBeNull()
    expect(a.basis).toEqual([])
  })

  it('says nothing when there are no labels at all', () => {
    expect(scoutAngle({ labels: [], scores: NO_SCORES, anySufficient: true }).approach).toBeNull()
  })

  it('returns null rather than an empty string when it has nothing to add', () => {
    /*
     * A caller doing `?? ''` cannot tell these apart, but one doing `angle.approach ? … : null`
     * can — and rendering an empty bubble where advice should be is worse than rendering
     * nothing, because it looks like a failed load.
     */
    const a = scoutAngle({ labels: ['rookie-heavy'], scores: NO_SCORES, anySufficient: true })
    expect(a.approach).toBeNull()
    expect(a.approach).not.toBe('')
  })
})

describe('it reads the labels the engine actually emits', () => {
  it('tells a win-now manager apart from a rebuilder, and inverts the advice', () => {
    const winNow = scoutAngle({ labels: ['win-now'], scores: NO_SCORES, anySufficient: true })
    const rebuild = scoutAngle({
      labels: ['patient rebuilder'],
      scores: NO_SCORES,
      anySufficient: true,
    })

    expect(winNow.approach).toMatch(/production this season/i)
    expect(winNow.approach).toMatch(/picks and youth read as a downgrade/i)

    expect(rebuild.approach).toMatch(/wants picks and youth/i)
    expect(rebuild.avoid).toMatch(/ageing production/i)

    // The two must not collapse into the same advice — that would make the label decorative.
    expect(winNow.approach).not.toBe(rebuild.approach)
  })

  it('tells a quiet strategist they will not open, and says what fails', () => {
    const a = scoutAngle({ labels: ['quiet strategist'], scores: NO_SCORES, anySufficient: true })
    expect(a.approach).toMatch(/first move has to be yours/i)
    expect(a.avoid).toMatch(/open-ended/i)
  })

  it('warns that a value-first manager punishes a lowball', () => {
    const a = scoutAngle({ labels: ['value-first'], scores: NO_SCORES, anySufficient: true })
    expect(a.approach).toMatch(/already grades fair/i)
    expect(a.avoid).toMatch(/light first offer/i)
  })
})

describe('scores refine the labels and never speak alone', () => {
  it('treats a null score as unobserved, not as zero', () => {
    /*
     * 🛑 THE FAILURE THIS PREVENTS. `tradeFrequencyScore` null means "below the evidence floor".
     * Read as 0 it satisfies `<= 20` and produces "they have barely made a trade" — a specific
     * claim about a named person, manufactured entirely from our own missing data.
     */
    const a = scoutAngle({
      labels: ['quiet strategist'],
      scores: { ...NO_SCORES, tradeFrequencyScore: null },
      anySufficient: true,
    })
    expect(a.avoid ?? '').not.toMatch(/barely made/i)
    expect(a.basis.join(' ')).not.toMatch(/trade frequency/i)
  })

  it('does add the warning when the score is genuinely low', () => {
    const a = scoutAngle({
      labels: ['quiet strategist'],
      scores: { ...NO_SCORES, tradeFrequencyScore: 8 },
      anySufficient: true,
    })
    expect(a.avoid).toMatch(/barely made/i)
    expect(a.basis).toContain('trade frequency 8')
  })

  it('does not repeat the trade-frequency warning for a trade-heavy manager', () => {
    // Contradictory advice in one card destroys trust in all of it.
    const a = scoutAngle({
      labels: ['trade-heavy'],
      scores: { ...NO_SCORES, tradeFrequencyScore: 10 },
      anySufficient: true,
    })
    expect(a.avoid ?? '').not.toMatch(/barely made/i)
  })
})

describe('it shows its working', () => {
  it('names every label and score the advice rests on', () => {
    const a = scoutAngle({
      labels: ['win-now', 'value-first'],
      scores: { ...NO_SCORES, activityScore: 90 },
      anySufficient: true,
    })
    expect(a.basis).toContain('win-now')
    expect(a.basis).toContain('value-first')
    expect(a.basis).toContain('activity 90')
  })
})
