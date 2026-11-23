import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/* /admin/trade-market renders every section, marks published rows, and shows the line a grade prints. */

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/adminAuth', () => ({ getAdminAccessState: async () => ({ status: 'ok' }) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: async ({ where }: { where: { cacheKey: string } }) =>
        where.cacheKey.includes('pick-values')
          ? {
              data: {
                generatedAt: new Date(Date.now() - 3_600_000).toISOString(),
                books: [{ book: 'DYNASTY:SUPERFLEX', tradesUsed: 900, roundsOrdered: true, horizonsOrdered: true, classes: [
                  { key: '1:0', round: 1, horizon: 0, prior: 4000, learned: 4600, ratio: 1.15, effectiveSample: 61, trades: 88, published: true, value: 4600, note: 'measured' },
                ] }],
              },
            }
          : null,
    },
  },
}))

const { default: TradeMarketPage } = await import('@/app/admin/trade-market/page')

describe('/admin/trade-market', () => {
  it('shows each learner, its switch, whether the table exists, and the grade line', async () => {
    render(await TradeMarketPage())
    expect(screen.getByTestId('admin-trade-market-summary').textContent).toMatch(/1 of 1 measured numbers are published/)
    expect(screen.getByTestId('status-posture').textContent).toMatch(/Not written yet/)
    expect(screen.getByTestId('switch-picks').textContent).toMatch(/TRADE_LEARNED_PICKS (on|off) on this service/)
    expect(screen.getByText(/AllFantasy pick market \+15%/)).toBeTruthy()
    expect(document.querySelector('[data-published="yes"]')).not.toBeNull()
  })
})
