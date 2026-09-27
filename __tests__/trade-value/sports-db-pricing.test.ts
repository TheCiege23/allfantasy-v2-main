import { describe, expect, it } from 'vitest'
import type { SportsPlayerRecord } from '@prisma/client'
import { sportsRecordToPricedAsset } from '@/lib/trade-value-console/sports-db-valuation'

describe('projection-derived college values', () => {
  it('does not turn absent or non-positive production into a fabricated 200-point price', () => {
    for (const points of [null, 0, -5]) {
      expect(sportsRecordToPricedAsset({ name: 'College player', position: 'QB', dynastyValue: null,
        projections: points == null ? {} : { fantasyPoints: points } } as SportsPlayerRecord)).toBeNull()
    }
    expect(sportsRecordToPricedAsset({ name: 'College player', position: 'QB', dynastyValue: null,
      projections: { fantasyPoints: 20 } } as SportsPlayerRecord)?.value).toBe(900)
  })
})
