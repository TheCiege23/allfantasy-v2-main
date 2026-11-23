/**
 * Keeper commissioner center (2026-11-22, keeper audit items 3, 4 and 7).
 *
 * The review table was `min-w-[520px]` inside a sideways scroller, so on a 390px phone the Status column and the
 * Confirm / Reject buttons sat off-screen. In light mode the "Active declaration session" heading (#ffd7e5 on a
 * pink wash) and the Reject buttons (rose-200) were near-invisible, and statuses printed raw ("pending").
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { KeeperCommissionerDashboard } from '@/app/league/[leagueId]/components/KeeperCommissionerDashboard'

const CONTEXT = {
  league: { keeperCount: 3, keeperCostSystem: 'round_based', keeperPhaseActive: true, keeperSelectionDeadline: '2027-08-20T23:00:00Z' },
  seasons: [{ id: 's27', season: 2027, status: 'pre_draft' }],
  suggestedIncomingSeasonId: 's27',
  session: { id: 'sess', seasonId: 's27', status: 'open', deadline: '2027-08-20T23:00:00Z', openedAt: '2027-08-01T00:00:00Z', teamsSubmitted: 7, totalTeams: 12, lockedAt: null },
}
const RECORDS = [
  { id: 'k1', rosterId: 'r1', teamName: 'Second Chance Saloon', ownerLabel: 'You', playerName: 'Puka Nacua', position: 'WR', status: 'pending', costRound: 9, costLabel: null },
  { id: 'k2', rosterId: 'r2', teamName: 'Gridiron Gang', ownerLabel: 'Sam', playerName: "Ja'Marr Chase", position: 'WR', status: 'confirmed', costRound: 1, costLabel: null },
]
const patch = vi.fn()

beforeEach(() => {
  patch.mockReset()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.startsWith('/api/keeper/context')) return body(CONTEXT)
    if (url.startsWith('/api/keeper/commissioner/records')) return body({ records: RECORDS })
    if (url === '/api/keeper/selections' && init?.method === 'PATCH') { patch(JSON.parse(String(init.body))); return body({ ok: true }) }
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function center() {
  const { container } = render(<KeeperCommissionerDashboard leagueId="L" />)
  await screen.findByText('Puka Nacua')
  return container
}

describe('Keeper commissioner review fits a phone', () => {
  it('has no fixed-width table that needs a sideways scroll', async () => {
    const el = await center()
    expect(el.querySelector('table')).toBeNull()
    expect(Array.from(el.querySelectorAll('[class*="min-w-["]'))).toEqual([])
  })

  it('names the player on Confirm and Reject, and sends the right action', async () => {
    await center()
    const row = screen.getByTestId('keeper-review-k1')
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm Puka Nacua' }))
    await waitFor(() => expect(patch).toHaveBeenCalledWith(expect.objectContaining({ keeperRecordId: 'k1', action: 'confirm' })))
    expect(within(row).getByRole('button', { name: 'Reject Puka Nacua' })).toBeTruthy()
    expect(within(screen.getByTestId('keeper-review-k2')).queryAllByRole('button')).toHaveLength(0)
  })
})

describe('Keeper commissioner center is readable in light mode and says statuses plainly', () => {
  it('uses no class the global light-mode rule rewrites, and no hard-coded hex colour', async () => {
    const el = await center()
    const offenders = Array.from(el.querySelectorAll('*'))
      .map((n) => n.getAttribute('class') ?? '')
      .filter((c) => /text-white|bg-\[#|text-\[#|border-\[#|-200\b|-100\/|text-amber|text-rose|text-emerald|bg-sky/.test(c))
    expect(offenders).toEqual([])
  })

  it('reads statuses as words', async () => {
    const el = await center()
    expect(within(screen.getByTestId('keeper-review-k1')).getByText('Waiting for you')).toBeTruthy()
    expect(within(screen.getByTestId('keeper-review-k2')).getByText('Confirmed')).toBeTruthy()
    expect(el.textContent).not.toMatch(/\bpending\b|pre_draft|Active declaration session/)
  })
})
