/**
 * Cap home's contracts card on a phone (2026-11-07, Salary Cap audit item 4). The card listed every contract — 20+
 * tall rows at 390px, ahead of the offseason calendar and the cap rules — and its table had a 520px floor inside a
 * narrower card, so it scrolled sideways and clipped its last header to "YEAR LEF". Now the card shows the biggest
 * contracts with a button to the full Contracts view (cut players' dead money stays visible), and on a narrow card
 * the status tags move under the player's name so the table fits without a sideways scroll.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { SalaryCapSpecialtyHome } from '@/components/league/specialty/salary/SalaryCapSpecialtyHome'

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
afterEach(cleanup)

const contracts = Array.from({ length: 20 }, (_, i) => ({
  id: `c${i}`, playerId: `p${i}`, playerName: `Player ${String.fromCharCode(65 + i)}`, position: 'WR',
  salary: (i * 7) % 23 + 1, yearsTotal: 3, contractYear: 1, yearsRemaining: 2, status: 'active', source: 'free_agency',
}))
const summary = {
  config: { mode: 'dynasty', startupCap: 250, capGrowthPercent: 5, contractMinYears: 1, contractMaxYears: 4, rookieContractYears: 3, minimumSalary: 1,
    deadMoneyEnabled: true, deadMoneyPercentPerYear: 25, rolloverEnabled: false, rolloverMax: 0, capFloorEnabled: false, capFloorAmount: null,
    extensionsEnabled: true, franchiseTagEnabled: true, startupDraftType: 'auction', futureDraftType: 'snake', auctionHoldback: 0, weightedLotteryEnabled: false, offseasonPhase: 'in_season' },
  myRosterId: 'r',
  ledger: { rosterId: 'r', capYear: 2026, totalCapHit: 200, deadMoneyHit: 4, rolloverUsed: 0, capSpace: 46 },
  futureProjection: [],
  contracts, expiringCount: 0, extensionCandidatesCount: 0, tagCandidatesCount: 0, deadMoneyTotal: 4, rookieContractCount: 0,
  events: [], lottery: null,
  league: { name: 'L', sport: 'NFL', season: 2026, teamCount: 12, capYear: 2026 },
  deadContracts: [{ id: 'd1', playerName: 'Cut Guy', position: 'RB', deadThisYear: 4 }],
}

describe('Cap home contracts card', () => {
  it('shows the six biggest contracts, the dead-money rows, and a way to all of them', () => {
    const open = vi.fn()
    render(<SalaryCapSpecialtyHome summary={summary as any} onOpenContracts={open} onOpenBid={() => {}} tradesHref="#" />)
    const card = screen.getByTestId('salary-contracts')
    const names = within(card).getAllByRole('row').slice(1).map(r => r.querySelector('strong')?.textContent)
    const top6 = [...contracts].sort((a, b) => b.salary - a.salary).slice(0, 6).map(c => c.playerName)
    expect(names).toEqual([...top6, 'Cut Guy'])
    fireEvent.click(within(card).getByRole('button', { name: 'All 20 contracts' }))
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('a short roster shows every contract and no "All" button', () => {
    render(<SalaryCapSpecialtyHome summary={{ ...summary, contracts: contracts.slice(0, 4) } as any} onOpenContracts={() => {}} onOpenBid={() => {}} tradesHref="#" />)
    const card = screen.getByTestId('salary-contracts')
    expect(within(card).getAllByRole('row')).toHaveLength(1 + 4 + 1)
    expect(within(card).queryByRole('button', { name: /^All \d+ contracts$/ })).toBeNull()
  })
})

describe('the years column keeps its full name for screen readers', () => {
  it('is announced as "Years left" whatever it shows', () => {
    render(<SalaryCapSpecialtyHome summary={summary as any} onOpenContracts={() => {}} onOpenBid={() => {}} tradesHref="#" />)
    expect(within(screen.getByTestId('salary-contracts')).getByRole('columnheader', { name: 'Years left' })).toBeTruthy()
  })
})

describe('narrow card: the table fits', () => {
  const css = readFileSync('components/league/specialty/salary/salary-specialty.module.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  function block(prelude: RegExp) {
    const at = css.search(prelude); if (at < 0) return null
    const open = css.indexOf('{', at); let depth = 0
    for (let k = open; k < css.length; k++) { if (css[k] === '{') depth++; else if (css[k] === '}' && --depth === 0) return css.slice(open + 1, k) }
    return null
  }
  it('the table wrapper is its own container', () => {
    expect(css).toMatch(/\.tblWrap\s*\{[^}]*container:\s*sc-contracts\s*\/\s*inline-size/)
  })
  it('below the band: no 520px floor, the Status column hides, tags show under the name', () => {
    const band = block(/@container\s+sc-contracts\s*\(\s*max-width:\s*\d+px\s*\)\s*\{/)
    expect(band, 'no @container sc-contracts band').not.toBeNull()
    expect(band).toMatch(/\.tbl\s*\{[^}]*min-width:\s*0/)
    expect(band).toMatch(/\.statusCol\s*\{[^}]*display:\s*none/)
    expect(band).toMatch(/\.tagsUnder\s*\{[^}]*display:\s*flex/)
    // Measured: the card is 264px wide at 390px, so Pos moves under the name too and the header shortens.
    expect(band).toMatch(/\.posCol\s*\{[^}]*display:\s*none/)
    expect(band).toMatch(/\.thLong\s*\{[^}]*display:\s*none/)
    expect(band).toMatch(/\.thShort\s*\{[^}]*display:\s*inline/)
    expect(band).toMatch(/\.tagsUnder\s*>\s*span\s*\{[^}]*white-space:\s*normal/)
    expect(css).toMatch(/^\.tagsUnder\s*\{[^}]*display:\s*none/m)
  })
})
