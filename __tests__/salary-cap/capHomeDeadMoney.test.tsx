/**
 * Cap home counts dead money the way the cap engine does (2026-11-07, Salary Cap audit item 2).
 *
 * lib/salary-cap/CapCalculationService writes the ledger with `totalCapHit` = ACTIVE CONTRACTS ONLY and dead money in
 * its own field: capSpace = cap + rollover − totalCapHit − deadMoneyHit, and the legality check adds the two.
 * FutureCapProjectionService does the same per year. Cap home's helper assumed the opposite ("totalCapHit already
 * includes dead money"), so it showed committed WITHOUT dead money, "Active contracts" with dead money subtracted a
 * second time, and flagged a future year "Over the cap" on contracts alone. The Cap space screen was right; on one
 * over-the-cap roster the two disagreed by the dead money ($259 vs $263 committed, $255 vs $259 active).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { capBarSegments } from '@/lib/salary-cap/capHomeView'
import { SalaryCapSpecialtyHome } from '@/components/league/specialty/salary/SalaryCapSpecialtyHome'

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
afterEach(cleanup)

// As the engine writes it: $259 of contracts, $4 dead, $3 rollover on a $250 cap → $10 over.
const LEDGER = { rosterId: 'r', capYear: 2026, totalCapHit: 259, deadMoneyHit: 4, rolloverUsed: 3, capSpace: 250 + 3 - 259 - 4 }

describe('cap bar segments', () => {
  it('active is the contract hit; committed adds dead money', () => {
    const seg = capBarSegments(LEDGER, 250)
    expect(seg.active).toBe(259)
    expect(seg.dead).toBe(4)
    expect(seg.committed).toBe(263)
  })
})

const summary = {
  config: { mode: 'dynasty', startupCap: 250, capGrowthPercent: 5, contractMinYears: 1, contractMaxYears: 4, rookieContractYears: 3, minimumSalary: 1,
    deadMoneyEnabled: true, deadMoneyPercentPerYear: 25, rolloverEnabled: true, rolloverMax: 10, capFloorEnabled: false, capFloorAmount: null,
    extensionsEnabled: true, franchiseTagEnabled: true, startupDraftType: 'auction', futureDraftType: 'snake', auctionHoldback: 0, weightedLotteryEnabled: false, offseasonPhase: 'in_season' },
  myRosterId: 'r',
  ledger: LEDGER,
  // 2027: contracts $258 under a $263 ceiling, but $8 of dead money puts the year over (projectedSpace −3).
  futureProjection: [
    { capYear: 2026, capCeiling: 250, totalCapHit: 259, deadMoney: 4, projectedSpace: -10, contractCount: 20 },
    { capYear: 2027, capCeiling: 263, totalCapHit: 258, deadMoney: 8, projectedSpace: -3, contractCount: 15 },
    { capYear: 2028, capCeiling: 276, totalCapHit: 81, deadMoney: 0, projectedSpace: 195, contractCount: 6 },
  ],
  contracts: [], expiringCount: 0, extensionCandidatesCount: 0, tagCandidatesCount: 0, deadMoneyTotal: 4, rookieContractCount: 0,
  events: [], lottery: null,
  league: { name: 'Cap Space Cadets', sport: 'NFL', season: 2026, teamCount: 12, capYear: 2026 },
  deadContracts: [],
}

describe('Cap home', () => {
  it('headline and cap bar include dead money; "Active contracts" does not subtract it twice', () => {
    render(<SalaryCapSpecialtyHome summary={summary as any} onOpenContracts={() => {}} onOpenBid={() => {}} tradesHref="#" />)
    expect(screen.getByText(/\$263(\.0)? of \$250(\.0)? committed/)).toBeTruthy()
    expect(screen.getByText(/Active contracts \$259/)).toBeTruthy()
  })

  it('a future year is over the cap when its projected space is negative, dead money included', () => {
    render(<SalaryCapSpecialtyHome summary={summary as any} onOpenContracts={() => {}} onOpenBid={() => {}} tradesHref="#" />)
    const col2027 = screen.getByText('2027').closest('[data-cap-year]') as HTMLElement
    expect(col2027, 'each future-year column carries data-cap-year').toBeTruthy()
    expect(within(col2027).getByText('Over the cap')).toBeTruthy()
    expect(within(col2027).getByText(/\$266(\.0)? \/ \$263/)).toBeTruthy()
  })
})
