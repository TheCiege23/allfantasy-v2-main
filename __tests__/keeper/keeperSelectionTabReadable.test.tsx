/**
 * Keepers tab: readable in light mode, one headline, plain words (2026-11-22, keeper audit items 6 and 7).
 *
 * The hero title sat on the bright keeper artwork as `text-white`, which light mode turns dark; the pink
 * "Projected cost" and green value lines were faint; a locked window faded every row to 50%; and the copy said
 * "Status: Open", "(round penalty, salary, etc.)" and raw "pending".
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

import { KeeperSelectionTab } from '@/app/league/[leagueId]/tabs/KeeperSelectionTab'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function stub(status: 'open' | 'locked') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = url.includes('/api/keeper/context')
      ? { league: { keeperCount: 3 }, session: { id: 's', seasonId: 'S', status, deadline: new Date(Date.now() + 864e5).toISOString(), teamsSubmitted: 7, totalTeams: 12 }, viewerRoster: { id: 'R', seasonId: 'S' } }
      : url.includes('/api/keeper/eligibility')
        ? { raw: [
            { playerId: 'p1', isEligible: true, ineligibleReason: null, projectedCost: 'Round 9', projectedCostRound: 9, yearsKept: 0 },
            { playerId: 'p2', isEligible: false, ineligibleReason: 'Kept the maximum 3 seasons', projectedCost: null, projectedCostRound: null, yearsKept: 3 },
          ], valueReport: { available: true, values: { p1: { marketRank: 10, pickSlot: 102, surplus: 92 } } } }
        : url.includes('/api/redraft/roster')
          ? { roster: { players: [{ playerId: 'p1', playerName: 'Star Guy', position: 'WR' }, { playerId: 'p2', playerName: 'Old Guy', position: 'WR' }] } }
          : { records: [{ id: 'k1', playerId: 'p1', playerName: 'Star Guy', status: 'pending', costRound: 9, costLabel: null }] }
    return { ok: true, json: async () => body }
  }))
}

async function tab(status: 'open' | 'locked' = 'open') {
  stub(status)
  const { container } = render(<KeeperSelectionTab leagueId="L" />)
  await screen.findByText('Star Guy', { selector: '[data-testid="keeper-select-p1"] *' })
  return container
}

describe('Keepers tab is readable in light mode', () => {
  it('uses no class the global light-mode rule rewrites, and no fixed colour', async () => {
    const el = await tab()
    const offenders = Array.from(el.querySelectorAll('*'))
      .map((n) => n.getAttribute('class') ?? '')
      .filter((c) => /text-white|bg-\[#|text-\[#|from-\[#|bg-black|text-amber|text-rose|text-emerald|bg-amber/.test(c))
    expect(offenders).toEqual([])
  })

  it('keeps the headline off the artwork', async () => {
    const el = await tab()
    const headings = el.querySelectorAll('h2')
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('Pick your keepers')
    expect(headings[0].closest('[data-testid="keeper-hero-media"]')).toBeNull()
  })

  it('does not fade the roster once keepers are locked', async () => {
    const el = await tab('locked')
    const row = screen.getByTestId('keeper-select-p1')
    expect(row.getAttribute('class')).not.toMatch(/opacity-50/)
    expect(el.textContent).toMatch(/Keepers are locked/)
  })
})

describe('Keepers tab speaks plainly', () => {
  it('states the window, the count and the league’s progress in words', async () => {
    const el = await tab()
    expect(el.textContent).toMatch(/Pick up to 3 keepers by/)
    expect(el.textContent).toMatch(/1 of 3 picked/)
    expect(el.textContent).toMatch(/7 of 12 teams have picked/)
    expect(el.textContent).not.toMatch(/Status:|round penalty, salary|\bpending\b|— pending/)
  })

  it('says what a keeper costs and where his submission stands', async () => {
    await tab()
    expect(within(screen.getByTestId('keeper-select-p1')).getByText(/Keeping him costs a round 9 pick/)).toBeTruthy()
    expect(within(screen.getByTestId('keeper-submitted')).getByText(/Waiting for your commissioner/)).toBeTruthy()
  })
})
