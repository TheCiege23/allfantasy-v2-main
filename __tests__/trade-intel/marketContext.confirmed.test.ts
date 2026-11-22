import { describe, expect, it } from 'vitest'
import { marketContextFor } from '@/lib/trade-intel/marketContext'

describe('confirmed type in trade market context', () => {
  it('recognizes the saved Best Ball concept and preserves its dynasty base', () => {
    const context = marketContextFor({
      isDynasty: true,
      leagueTypeConfirmation: { type: 'best_ball' },
      scoring_settings: { rec: 0.5 },
    }, 'dynasty', 12)
    expect(context.variant).toMatchObject({ bestBall: true, dynasty: true })
    expect(context.scoring.receptionWeight).toBe(0.5)
  })

  it('clears stale Best Ball and dynasty flags after a redraft confirmation', () => {
    const context = marketContextFor({
      best_ball: 1, isDynasty: true,
      leagueTypeConfirmation: { type: 'redraft' },
    }, 'dynasty', 12)
    expect(context.variant).toMatchObject({ bestBall: false, dynasty: false })
  })
})
