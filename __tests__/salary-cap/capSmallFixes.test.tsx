/**
 * Salary Cap small fixes (2026-11-07, Salary Cap audit item 5):
 *   - money: "$-10" / "$196.0" → one format, a real minus before the dollar, decimals only when there is a fraction
 *   - over the cap was drawn in healthy-space green, and Cap home had no warning at all (Cap space did)
 *   - "1 contracts"; a raw status value ("option_exercised") in the Contracts table
 *   - "years left" counted this season on Cap home and not on Contracts (one contract: 3 vs 2)
 *   - the Cap space tile labelled contracts-only money "Committed cap" while Cap home's committed includes dead money
 *   - every sub-view drew its own "Back" link inside the workspace, where the sidebar navigates
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { contractStatusLabel, formatCapMoney, isOverCap, yearsLeftIncludingThisSeason } from '@/lib/salary-cap/capMoney'
import { CapDashboard } from '@/components/salary-cap/CapDashboard'
import { ContractsPage } from '@/components/salary-cap/ContractsPage'
import { TeamBuilderView } from '@/components/salary-cap/TeamBuilderView'
import { SalaryCapSpecialtyHome } from '@/components/league/specialty/salary/SalaryCapSpecialtyHome'
import { SalaryCapHome } from '@/components/salary-cap/SalaryCapHome'

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const cfg = { mode: 'dynasty', startupCap: 250, capGrowthPercent: 5, contractMinYears: 1, contractMaxYears: 4, rookieContractYears: 3, minimumSalary: 1,
  deadMoneyEnabled: true, deadMoneyPercentPerYear: 25, rolloverEnabled: true, rolloverMax: 10, capFloorEnabled: false, capFloorAmount: null,
  extensionsEnabled: true, franchiseTagEnabled: true, startupDraftType: 'auction', futureDraftType: 'snake', auctionHoldback: 0, weightedLotteryEnabled: false, offseasonPhase: 'in_season' }
// Engine-shaped: $259 of contracts, $4 dead, $3 rollover on $250 → $10 over.
const over = {
  config: cfg, myRosterId: 'r',
  ledger: { rosterId: 'r', capYear: 2026, totalCapHit: 259, deadMoneyHit: 4, rolloverUsed: 3, capSpace: -10 },
  futureProjection: [{ capYear: 2026, capCeiling: 250, totalCapHit: 259, deadMoney: 4, projectedSpace: -10, contractCount: 3 },
    { capYear: 2027, capCeiling: 263, totalCapHit: 120, deadMoney: 0, projectedSpace: 143, contractCount: 2 }],
  contracts: [
    { id: 'a', playerId: 'a', playerName: 'Jordan Love', position: 'QB', salary: 6, yearsTotal: 3, contractYear: 2, yearsRemaining: 1, status: 'option_exercised', source: 'trade' },
    { id: 'b', playerId: 'b', playerName: 'Brandon Aubrey', position: 'K', salary: 1, yearsTotal: 1, contractYear: 1, yearsRemaining: 0, status: 'active', source: 'waiver_bid' },
  ],
  expiringCount: 1, extensionCandidatesCount: 1, tagCandidatesCount: 0, deadMoneyTotal: 4, rookieContractCount: 0, events: [], lottery: null,
  league: { name: 'L', sport: 'NFL', season: 2026, teamCount: 12, capYear: 2026 }, deadContracts: [],
} as any

describe('money', () => {
  it('one format: real minus before the dollar, decimals only for fractions', () => {
    expect(formatCapMoney(-10)).toBe('−$10')
    expect(formatCapMoney(196)).toBe('$196')
    expect(formatCapMoney(12.5)).toBe('$12.5')
    expect(formatCapMoney(null)).toBe('—')
    expect(isOverCap(-0.1)).toBe(true)
    expect(isOverCap(0)).toBe(false)
  })
})

describe('Cap space screen', () => {
  it('shows over-the-cap money in the warning colour with a real minus, and says what the hit counts', () => {
    render(<CapDashboard summary={over} leagueId="l" />)
    const space = screen.getByText('−$10', { selector: 'p' })
    expect(space.className).toMatch(/text-red-300/)
    expect(space.className).not.toMatch(/emerald/)
    expect(screen.getByText('Active contracts (this year)')).toBeTruthy()
    expect(screen.queryByText(/\$-/)).toBeNull()
    expect(screen.getByText('$10 over').className).toMatch(/text-red-300/)
  })
})

describe('Cap home', () => {
  it('warns when over the cap', () => {
    render(<SalaryCapSpecialtyHome summary={over} onOpenContracts={() => {}} onOpenBid={() => {}} tradesHref="#" />)
    expect(screen.getByTestId('salary-over-cap').textContent).toBe('Over the cap by $10')
    expect(within(screen.getByTestId('salary-cap-space')).getByText('−$10')).toBeTruthy()
  })
})

describe('Contracts and Team builder copy', () => {
  it('readable statuses and years left that count this season, as Cap home does', () => {
    render(<ContractsPage summary={over} leagueId="l" />)
    const love = screen.getByText('Jordan Love').closest('tr') as HTMLElement
    expect(within(love).getByText('Option exercised')).toBeTruthy()
    expect(within(love).getByText(String(yearsLeftIncludingThisSeason(over.contracts[0])))).toBeTruthy()
    expect(screen.queryByText('option_exercised')).toBeNull()
    expect(contractStatusLabel('some_new_state')).toBe('Some new state')
  })
  it('"1 contract", not "1 contracts"', () => {
    render(<TeamBuilderView summary={over} leagueId="l" />)
    expect(screen.getAllByText('1 contract').length).toBeGreaterThan(0)
    expect(screen.queryByText('1 contracts')).toBeNull()
  })
})

describe('Back links', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => over })))
  it('are not drawn inside the workspace', async () => {
    render(<SalaryCapHome leagueId="l" initialView="contracts" shellNav />)
    await screen.findByText('Jordan Love')
    expect(screen.queryByRole('button', { name: /Back/ })).toBeNull()
  })
  it('stay outside it', async () => {
    render(<SalaryCapHome leagueId="l" initialView="contracts" />)
    await screen.findByText('Jordan Love')
    expect(screen.getByRole('button', { name: /Back/ })).toBeTruthy()
  })
})
