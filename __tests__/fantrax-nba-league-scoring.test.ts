import { describe, expect, it } from 'vitest'
import { extractScoringSettings } from '@/lib/projections/leagueScoring'
import { leagueProjectionGap } from '@/lib/core-app/playerProjections'

describe('imported Fantrax NBA scoring', () => {
  it('reads the six saved stat weights instead of treating the metadata wrapper as rules', () => {
    const scoring = extractScoringSettings({
      scoringSettings: {
        source: 'fantrax',
        format: 'HEAD_TO_HEAD_POINTS_BASED',
        scoringTemplateId: 'nba_points',
        rules: { pts: 1, reb: 1.25, ast: 1.5, stl: 2, blk: 2, to: -1 },
      },
    })

    expect(scoring).toEqual({ pts: 1, reb: 1.25, ast: 1.5, stl: 2, blk: 2, to: -1 })
    expect(leagueProjectionGap({ scoringSettings: scoring, starters: 10, pricedStarters: 0 }))
      .not.toMatch(/no scoring settings/i)
  })
})
