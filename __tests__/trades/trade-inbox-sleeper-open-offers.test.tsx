/**
 * Sleeper's public feed carries a trade only once it is accepted, so the Trade Center must never
 * read an empty Sleeper inbox as "nothing is waiting" — and must give the manager a way to grade
 * the offer they can see on Sleeper and we cannot.
 *
 * Measured on production 2026-09-28: 2,154 swept Sleeper trades in `provider_trade_offers` and
 * 28,167 trade rows in `dw_transaction_facts`, every one `complete`. Reported case: KBFL
 * (1338541390891606016), a Tyrone Tracy ↔ Quincy Williams offer visible in Sleeper, absent from
 * every week 0–18 of the feed.
 *
 * ⚠ RENDERED, NOT GREPPED — a source string would stay green with the button never mounted.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchTradesPanel = vi.fn()
vi.mock('@/components/core-app/screens/tradesPanelFetch', () => ({
  fetchTradesPanel: (...args: unknown[]) => fetchTradesPanel(...args),
}))

import { TradeInbox } from '@/components/core-app/screens/TradeInbox'

function panel(platform: string, scanned = true) {
  return {
    ok: true,
    status: 200,
    data: {
      activeTrades: [],
      historyTrades: [],
      pending: {
        scanned,
        reason: scanned ? null : 'Sleeper could not be reached',
        platform,
        leagueUrl: 'https://sleeper.com/leagues/1338541390891606016',
        weeksUnanswered: 0,
        weeksRequested: 18,
        weeksAnswered: 18,
      },
      pendingOffers: [],
    },
  }
}

describe('TradeInbox — offers Sleeper does not publish', () => {
  beforeEach(() => fetchTradesPanel.mockReset())

  it('says Sleeper does not share open offers, instead of "nothing waiting"', async () => {
    fetchTradesPanel.mockResolvedValue(panel('sleeper'))
    render(<TradeInbox view="offers" leagueId="lg-sleeper" onLoad={() => {}} onEnterByHand={() => {}} />)

    expect(await screen.findByText(/Offers waiting in Sleeper don.t appear here/)).toBeTruthy()
    expect(screen.getAllByText(/None we can see/).length).toBe(2) // Inbox and Sent
    expect(screen.queryByText(/Nothing waiting on you right now/)).toBeNull()
    expect(screen.getByText(/Accepted trades last checked at/)).toBeTruthy()
    expect(screen.getByText(/Sleeper answered 18 of 18 weeks/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Sleeper' }).getAttribute('href')).toBe(
      'https://sleeper.com/leagues/1338541390891606016',
    )
  })

  it('the manual-entry button hands control to the builder', async () => {
    fetchTradesPanel.mockResolvedValue(panel('sleeper'))
    const onEnterByHand = vi.fn()
    render(<TradeInbox view="offers" leagueId="lg-sleeper-2" onLoad={() => {}} onEnterByHand={onEnterByHand} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Grade a Sleeper offer' }))
    expect(onEnterByHand).toHaveBeenCalledTimes(1)
  })

  it('draws no manual-entry button on a screen without a builder', async () => {
    fetchTradesPanel.mockResolvedValue(panel('sleeper'))
    render(<TradeInbox view="offers" leagueId="lg-sleeper-3" onLoad={() => {}} />)

    await screen.findByText(/Offers waiting in Sleeper don.t appear here/)
    expect(screen.queryByRole('button', { name: 'Grade a Sleeper offer' })).toBeNull()
  })

  it('claims no check time when the feed was not read', async () => {
    fetchTradesPanel.mockResolvedValue(panel('sleeper', false))
    render(<TradeInbox view="offers" leagueId="lg-sleeper-4" onLoad={() => {}} onEnterByHand={() => {}} />)

    await screen.findByText(/Offers waiting in Sleeper don.t appear here/)
    expect(screen.queryByText(/last checked/)).toBeNull()
    expect(screen.getAllByText('Sleeper could not be reached').length).toBe(2)
  })

  it('[control] a non-Sleeper league keeps its own empty state and gets no Sleeper note', async () => {
    fetchTradesPanel.mockResolvedValue(panel('yahoo'))
    render(<TradeInbox view="offers" leagueId="lg-yahoo" onLoad={() => {}} onEnterByHand={() => {}} />)

    expect(await screen.findByText('Nothing waiting on you right now.')).toBeTruthy()
    expect(screen.queryByText(/Offers waiting in Sleeper/)).toBeNull()
  })
})
