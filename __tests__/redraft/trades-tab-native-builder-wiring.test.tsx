/**
 * Regression lock for the NFL redraft Trades UI wiring bug: for `nflRedraftCore` leagues, the only
 * "Propose a trade" affordance used to be a `<Link href="/trade-finder">`, which is AI-suggestion /
 * Sleeper-deep-link / client-side-simulation only and never calls the real trade engine. This test
 * proves the tab now opens the native `ProposeTradeModal` (backed by the real
 * `POST /api/leagues/[leagueId]/trades`) instead, for both the persistent header button and the
 * empty-state affordance. The same league-aware builder is available in every
 * format; imported leagues label the result as a shadow plan.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { TradesTab } from '@/app/league/[leagueId]/tabs/TradesTab'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-a' } } }),
}))

vi.mock('@/lib/dashboard/open-chimmy-with-prompt', () => ({ openChimmyWithPrompt: vi.fn() }))

const nflRedraftLeague = {
  id: 'league-1',
  name: 'Test League',
  sport: 'NFL',
  leagueType: 'redraft',
  isDynasty: false,
  bestBallMode: false,
  guillotineMode: false,
  keeperPhaseActive: false,
  leagueVariant: null,
} as unknown as UserLeague

const sleeperLeague = {
  ...nflRedraftLeague,
  id: 'league-2',
  leagueType: 'dynasty',
} as unknown as UserLeague

function mockEmptyTradesPanel() {
  global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/trades/rosters')) {
      return { ok: true, json: async () => ({ rosters: [] }) }
    }
    return { ok: true, json: async () => ({ tradeBlock: [], activeTrades: [], activeCount: 0, source: 'native' }) }
  }) as unknown as typeof fetch
}

describe('TradesTab — native trade builder wiring for nflRedraftCore leagues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEmptyTradesPanel()
  })

  it('shows a native "Propose a Trade" button (not a /trade-finder link) in the header for nflRedraftCore leagues', async () => {
    render(<TradesTab league={nflRedraftLeague} teams={[]} />)
    await waitFor(() => expect(screen.getByTestId('trades-tab-propose-trade-header')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /propose a trade/i })).not.toBeInTheDocument()
  })

  it('opens the native ProposeTradeModal (not /trade-finder) from the empty-state affordance', async () => {
    render(<TradesTab league={nflRedraftLeague} teams={[]} />)
    const emptyStateTrigger = await screen.findByTestId('trades-tab-propose-trade')
    expect(emptyStateTrigger.tagName).toBe('BUTTON')
    fireEvent.click(emptyStateTrigger)
    await waitFor(() => expect(screen.getByTestId('propose-trade-partner-select')).toBeInTheDocument())
  })

  it('opens the league-aware builder for non-redraft formats too', async () => {
    render(<TradesTab league={sleeperLeague} teams={[]} />)
    const trigger = await screen.findByTestId('trades-tab-propose-trade')
    expect(trigger.tagName).toBe('BUTTON')
    expect(screen.getByTestId('trades-tab-propose-trade-header')).toBeInTheDocument()
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByTestId('propose-trade-partner-select')).toBeInTheDocument())
  })
})
