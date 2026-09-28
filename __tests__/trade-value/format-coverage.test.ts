import { describe, expect, it } from 'vitest'
import { tradeFormatCoverage } from '@/lib/trade-value-console/formatCoverage'
import { proposalEligibilityReason } from '@/lib/trade-value-console/tradeEligibility'

describe('shared trade format coverage', () => {
  it('withholds trades prohibited by the catalog even with balanced player prices', () => {
    for (const type of ['survivor_guillotine', 'tournament']) {
      const coverage = tradeFormatCoverage({ settings: null, leagueType: type })
      expect(coverage.prohibitedReason).toContain('trades are not permitted')
      expect(proposalEligibilityReason({ tradesEnabled: true, draftPickTrading: true,
        formatProhibition: coverage.prohibitedReason }, [{ pricedSource: 'fantasycalc' }])).toBe(coverage.prohibitedReason)
    }
  })
  it('does not claim contract or elimination pricing just because a league has a format label', () => {
    for (const type of ['keeper', 'salary_cap', 'guillotine', 'survivor', 'zombie', 'best_ball', 'big_brother', 'devy', 'c2c', 'pirate']) {
      const coverage = tradeFormatCoverage({ settings: null, leagueType: type })
      expect(coverage.gaps).toHaveLength(1)
    }
    for (const type of ['redraft', 'dynasty', 'DYNASTY_IDP']) {
      expect(tradeFormatCoverage({ settings: null, leagueType: type }).gaps).toEqual([])
    }
  })
})
