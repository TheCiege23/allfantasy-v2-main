import { describe, expect, it } from 'vitest'
import { resolveLeagueScoringContext } from '@/lib/league-trade-engine/tradeLearningCapture'

describe('live trade proposal value book', () => {
  it('uses a redraft half-PPR book for a redraft league', () => {
    const context = resolveLeagueScoringContext({
      isDynasty: false,
      leagueType: 'redraft',
      leagueVariant: 'standard',
      scoring: 'Half PPR',
      settings: { rosterSettings: { starterSlots: { QB: 1 } } },
    } as never)
    expect(context).toMatchObject({ isDynasty: false, ppr: 0.5, scoringType: 'half_ppr' })
  })

  it('uses the dynasty book for keeper leagues', () => {
    const context = resolveLeagueScoringContext({
      isDynasty: false,
      leagueType: 'keeper',
      leagueVariant: 'keeper',
      scoring: 'PPR',
      settings: null,
    } as never)
    expect(context).toMatchObject({ isDynasty: true, ppr: 1, scoringType: 'ppr' })
  })
})
