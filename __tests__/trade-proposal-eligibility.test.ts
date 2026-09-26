import { expect, it } from 'vitest'
import { proposalEligibilityReason } from '@/lib/trade-value-console/tradeEligibility'

it('withholds proposals prohibited by captured league rules', () => {
  expect(proposalEligibilityReason({ tradesEnabled: false, draftPickTrading: true }, [])).toContain('Trades are disabled')
  expect(proposalEligibilityReason({ tradesEnabled: true, draftPickTrading: false }, [{ pricedSource: 'pick' }])).toContain('Remove the picks')
  expect(proposalEligibilityReason({ tradesEnabled: true, draftPickTrading: false }, [{ pricedSource: 'fantasycalc' }])).toBeNull()
  expect(proposalEligibilityReason(undefined, [{ pricedSource: 'pick' }])).toBeNull()
})
