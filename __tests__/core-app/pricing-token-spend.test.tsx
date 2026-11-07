/**
 * The Plans page's weekly token-spend chart: weekly totals from the viewer's own ledger, net of refunds,
 * with purchases and the daily free grant left out — and the rendered chart, its table and its empty case.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/pricing',
  redirect: vi.fn(),
}))
vi.mock('@/lib/monetization/checkout-client', () => ({ resolveCheckoutUrl: vi.fn(async () => ({ ok: false as const, error: 'stopped in test' })) }))
vi.mock('@/hooks/usePostPurchaseSync', () => ({
  usePostPurchaseSync: () => ({ state: { phase: 'idle', message: '' }, isSyncing: false, retrySync: vi.fn() }),
}))
vi.mock('@/lib/geo/useGeoRestriction', () => ({
  useGeoRestriction: () => ({ isPaidBlocked: false, loading: false, stateName: null, stateCode: null }),
}))
vi.mock('@/components/tokens/TokenBalanceWidget', () => ({ TokenBalanceWidget: () => null }))

import { PricingV4 } from '@/components/core-app/screens/PricingV4'
import { weekStartUtc, weeklyTokenSpend } from '@/lib/tokens/weeklyTokenSpend'
import type { PricingAccount } from '@/lib/core-app/pricingAccount'

afterEach(() => cleanup())

// Thursday 2026-11-05; this week starts Monday 2026-11-02.
const NOW = new Date('2026-11-05T15:00:00Z')
const at = (iso: string) => new Date(iso)

describe('weeklyTokenSpend', () => {
  it('starts weeks on Monday UTC', () => {
    expect(weekStartUtc(NOW).toISOString().slice(0, 10)).toBe('2026-11-02')
    expect(weekStartUtc(at('2026-11-02T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-11-02')
    expect(weekStartUtc(at('2026-11-01T23:59:00Z')).toISOString().slice(0, 10)).toBe('2026-10-26')
  })

  it('sums spends net of refunds, ignores purchases and adjustments, oldest week first', () => {
    const weeks = weeklyTokenSpend([
      { createdAt: at('2026-11-03T10:00:00Z'), entryType: 'spend', tokenDelta: -5 },
      { createdAt: at('2026-11-04T10:00:00Z'), entryType: 'spend', tokenDelta: -3 },
      { createdAt: at('2026-11-04T11:00:00Z'), entryType: 'refund', tokenDelta: 3 },
      { createdAt: at('2026-11-04T12:00:00Z'), entryType: 'purchase', tokenDelta: 100 },
      { createdAt: at('2026-11-05T00:01:00Z'), entryType: 'adjustment', tokenDelta: 1 },
      { createdAt: at('2026-10-28T09:00:00Z'), entryType: 'spend', tokenDelta: -12 },
    ], NOW)
    expect(weeks).toHaveLength(8)
    expect(weeks[0].weekStart).toBe('2026-09-14')
    expect(weeks[7]).toEqual({ weekStart: '2026-11-02', spent: 5 })
    expect(weeks[6]).toEqual({ weekStart: '2026-10-26', spent: 12 })
    expect(weeks.slice(0, 6).every((w) => w.spent === 0)).toBe(true)
  })

  it('never goes below zero when a refund lands in the week after its spend', () => {
    const weeks = weeklyTokenSpend([{ createdAt: at('2026-11-03T10:00:00Z'), entryType: 'refund', tokenDelta: 4 }], NOW)
    expect(weeks[7].spent).toBe(0)
  })

  it('drops rows outside the eight-week window', () => {
    const weeks = weeklyTokenSpend([{ createdAt: at('2026-09-01T10:00:00Z'), entryType: 'spend', tokenDelta: -9 }], NOW)
    expect(weeks.reduce((s, w) => s + w.spent, 0)).toBe(0)
  })
})

const ACCOUNT = (weeklySpend: PricingAccount['weeklySpend']): PricingAccount => ({
  planIds: ['pro'], planName: 'AF Pro', renewsAt: null, tokenBalance: 40, weeklySpend,
})

describe('the token-spend chart', () => {
  const weeks = weeklyTokenSpend([
    { createdAt: at('2026-11-03T10:00:00Z'), entryType: 'spend', tokenDelta: -5 },
    { createdAt: at('2026-10-28T09:00:00Z'), entryType: 'spend', tokenDelta: -12 },
  ], NOW)

  it('draws eight bars, the total, and the same numbers in a table', () => {
    render(<PricingV4 plans={[]} packs={[]} savingsHeadline={null} signedIn account={ACCOUNT(weeks)} />)
    const chart = screen.getByTestId('pricing-spend')
    expect(within(chart).getByText('17 spent')).toBeTruthy()
    const bars = within(chart).getAllByTestId('pricing-spend-bar')
    expect(bars).toHaveLength(8)
    expect(bars[7].getAttribute('data-current')).toBe('true')
    expect(bars[7].querySelector('[aria-label]')?.getAttribute('aria-label')).toBe('Week of Nov 2: 5 tokens (this week so far)')
    const cells = [...chart.querySelectorAll('tbody td:last-child')].map((td) => td.textContent)
    expect(cells.slice(-2)).toEqual(['12', '5'])
  })

  it('says so plainly when nothing was spent, and draws no bars', () => {
    render(<PricingV4 plans={[]} packs={[]} savingsHeadline={null} signedIn account={ACCOUNT(weeklyTokenSpend([], NOW))} />)
    const chart = screen.getByTestId('pricing-spend')
    expect(within(chart).getByText('No tokens spent in the last 8 weeks.')).toBeTruthy()
    expect(within(chart).queryAllByTestId('pricing-spend-bar')).toHaveLength(0)
  })

  it('is absent when the ledger could not be read', () => {
    render(<PricingV4 plans={[]} packs={[]} savingsHeadline={null} signedIn account={ACCOUNT(null)} />)
    expect(screen.queryByTestId('pricing-spend')).toBeNull()
  })
})
