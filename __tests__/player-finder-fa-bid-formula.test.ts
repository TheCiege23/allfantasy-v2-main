/**
 * @vitest-environment node
 *
 * The FAAB bid formula the Player Finder's "available in your leagues" list uses — WaiverIntel's
 * market-anchored bid, as one helper — and the free-league rule the strip and the list share.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { FAAB_BID_CAP_PCT, faabBidFor } from '@/lib/trade-intel/marketValueService'
import { freeLeagueIds } from '@/lib/core-app/leagueStrip'

describe('faabBidFor', () => {
  it('value against the anchor, as a share of the budget', () => {
    // 1,500 is half the 3,000 anchor → half of a $100 budget.
    expect(faabBidFor(1500, 100, 3000)).toBe(50)
  })

  it('never more than 60% of the budget, never less than $1', () => {
    expect(faabBidFor(9000, 100, 3000)).toBe(60)
    expect(faabBidFor(5, 100, 3000)).toBe(1)
  })

  it('no bid without a budget, an anchor, or a value', () => {
    expect(faabBidFor(1500, null, 3000)).toBeNull()
    expect(faabBidFor(1500, 100, null)).toBeNull()
    expect(faabBidFor(0, 100, 3000)).toBeNull()
  })

  /*
   * ⚠ WAIVER INTEL STILL CARRIES THIS FORMULA INLINE — its file is a standing DB-first violation,
   * so it cannot be edited to call the helper without failing the guard. Until it is migrated, this
   * pins the two copies together: change one, and this says to change the other.
   */
  it('WaiverIntel’s inline copy is the same formula', () => {
    const src = readFileSync(path.join(process.cwd(), 'lib/waiver-intel/waiverIntelService.ts'), 'utf8')
    expect(FAAB_BID_CAP_PCT).toBe(0.6)
    expect(src).toContain('const BID_CAP_PCT = 0.6')
    expect(src).toContain('Math.max(1, Math.min(Math.round(budget * BID_CAP_PCT), Math.round((v / anchor) * budget)))')
  })
})

describe('freeLeagueIds', () => {
  it('in scope, read, and on no roster — never a league we could not read', () => {
    expect(freeLeagueIds(['A', 'B', 'C', 'D'], [{ leagueId: 'A' }], [{ leagueId: 'D' }])).toEqual(['B', 'C'])
  })
})
