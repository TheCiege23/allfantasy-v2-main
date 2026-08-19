import { describe, expect, it } from 'vitest'

import { computeDraftProjectionScore, enrichDevy } from '@/lib/engine/devy'

const player = (over: Record<string, unknown> = {}) =>
  ({
    name: 'Test Player',
    league: 'NCAA',
    devyEligible: true,
    graduatedToNFL: false,
    ...over,
  }) as never

describe('the trade engine will not score a devy player it knows nothing about', () => {
  it('returns null with no recruiting, round or ADP', () => {
    // Previously this produced ~33-50 out of pure defaults and then priced a real trade.
    expect(computeDraftProjectionScore(player())).toBeNull()
  })

  it('treats zero as absence rather than a rating of zero', () => {
    expect(computeDraftProjectionScore(player({ recruitingComposite: 0, devyAdp: 0 }))).toBeNull()
  })

  it('refuses to score on breakout age alone', () => {
    // Breakout age is a modifier, not an evaluation.
    expect(computeDraftProjectionScore(player({ breakoutAge: 19 }))).toBeNull()
  })

  it('scores on any one substantive signal', () => {
    expect(computeDraftProjectionScore(player({ recruitingComposite: 0.95 }))).toBe(95)
    expect(computeDraftProjectionScore(player({ projectedDraftRound: 1 }))).toBe(95)
    expect(computeDraftProjectionScore(player({ devyAdp: 2 }))).toBe(95)
  })

  it('does not dilute a lone strong signal toward average', () => {
    // Under the old model three phantom 50s dragged a 5-star down to ~57.
    expect(computeDraftProjectionScore(player({ recruitingComposite: 0.99 }))).toBe(99)
  })

  it('blends present signals by relative weight', () => {
    // recruiting 90 (w .25) + capital 95 (w .30) -> (22.5 + 28.5) / .55 = 92.7
    expect(computeDraftProjectionScore(player({ recruitingComposite: 0.9, projectedDraftRound: 1 }))).toBe(93)
  })

  it('applies injury only as a modifier, never as evidence', () => {
    const base = computeDraftProjectionScore(player({ recruitingComposite: 0.8 }))!
    const hurt = computeDraftProjectionScore(player({ recruitingComposite: 0.8, injurySeverityScore: 80 }))!
    expect(base).toBe(80)
    expect(hurt).toBe(76)
    // An injury flag alone still cannot produce a score.
    expect(computeDraftProjectionScore(player({ injurySeverityScore: 80 }))).toBeNull()
  })
})

describe('enrichDevy leaves unscorable players undefined', () => {
  it('does not invent a score', () => {
    const out = enrichDevy(player()) as { draftProjectionScore?: number }
    expect(out.draftProjectionScore).toBeUndefined()
  })

  it('keeps an explicit score already on the asset', () => {
    const out = enrichDevy(player({ draftProjectionScore: 71 })) as { draftProjectionScore?: number }
    expect(out.draftProjectionScore).toBe(71)
  })

  it('computes one when evidence exists', () => {
    const out = enrichDevy(player({ recruitingComposite: 0.9 })) as { draftProjectionScore?: number }
    expect(out.draftProjectionScore).toBe(90)
  })

  it('leaves non-devy assets alone', () => {
    const nfl = enrichDevy(player({ league: 'NFL', devyEligible: false })) as {
      draftProjectionScore?: number
    }
    expect(nfl.draftProjectionScore).toBeUndefined()
  })
})
