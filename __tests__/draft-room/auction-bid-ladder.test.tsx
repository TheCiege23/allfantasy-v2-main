// @vitest-environment jsdom
/**
 * Auction bid history, room half: the ladder lists team · amount · time newest first, for the player
 * on the block and for each recently sold player, and renders NOTHING — no empty box — when there are
 * no rows, the read fails, or the table does not exist yet (the route then answers `[]`).
 */
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'en', t: (k: string) => k }),
  useLanguage: () => ({ language: 'en', t: (k: string) => k, tInterpolate: (k: string) => k }),
}))

import { AuctionBidLadder } from '@/components/app/draft-room/AuctionBidLadder'
import { AuctionSpotlightPanel } from '@/components/app/draft-room/AuctionSpotlightPanel'
import { auctionBidPlayerKey, ladderFor, type AuctionBidRow } from '@/lib/draft-room/auctionBidLadder'
import type { AuctionSessionSnapshot, DraftPickSnapshot } from '@/lib/live-draft-engine/types'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const order = [
  { slot: 1, rosterId: 'r1', displayName: 'Alpha' },
  { slot: 2, rosterId: 'r2', displayName: 'Beta' },
  { slot: 3, rosterId: 'r3', displayName: 'Gamma' },
]
const names = (id: string) => order.find((o) => o.rosterId === id)?.displayName ?? '—'

const BIJAN = auctionBidPlayerKey({ playerName: 'Bijan Robinson' })
const BETA_BACK = auctionBidPlayerKey({ playerName: 'Beta Back' })
const bid = (id: string, playerKey: string, rosterId: string, amount: number, at: string): AuctionBidRow => ({
  id, playerKey, playerName: 'x', rosterId, amount, createdAt: at,
})
/** Deliberately NOT in time order: the ladder must sort. */
const HISTORY: AuctionBidRow[] = [
  bid('b2', BIJAN, 'r2', 30, '2026-11-06T18:00:20Z'),
  bid('b1', BIJAN, 'r1', 25, '2026-11-06T18:00:10Z'),
  bid('b3', BIJAN, 'r2', 40, '2026-11-06T18:00:40Z'),
  bid('b4', BIJAN, 'r3', 35, '2026-11-06T18:00:30Z'),
  bid('w1', BETA_BACK, 'r1', 45, '2026-11-06T17:50:00Z'),
  bid('w2', BETA_BACK, 'r2', 50, '2026-11-06T17:50:05Z'),
]

function pick(overall: number, rosterId: string, playerName: string, amount: number): DraftPickSnapshot {
  return {
    id: `p${overall}`, overall, round: 1, slot: 1, rosterId, displayName: names(rosterId), playerName, position: 'RB', team: 'ATL',
    byeWeek: null, playerId: null, tradedPickMeta: null, source: 'user', pickLabel: `1.0${overall}`, amount, createdAt: '2026-11-06T17:51:00Z',
  } as DraftPickSnapshot
}
const auction: AuctionSessionSnapshot = {
  draftType: 'auction',
  budgetPerTeam: 200,
  budgets: { r1: 195, r2: 150, r3: 200 },
  minBidIncrement: 1,
  nominationOrder: order,
  auctionState: {
    nominationOrderIndex: 1,
    currentNomination: { playerName: 'Bijan Robinson', position: 'RB', team: 'ATL' } as never,
    currentBid: 40,
    currentBidderRosterId: 'r2',
    bidTimerEndAt: null,
    minNextBid: 41,
  },
} as AuctionSessionSnapshot
const panel = {
  auction,
  currentUserRosterId: 'r1',
  isCommissioner: false,
  onNominate: () => {},
  onBid: () => {},
  onResolve: () => {},
  timerRemainingSeconds: 8,
  timerStatus: 'running' as const,
  rosterSize: 15,
  picks: [pick(1, 'r2', 'Beta Back', 50)],
  leagueId: 'lg-1',
}

const rungs = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-testid="auction-bid-rung"]')].map(
    (li) => `${li.querySelector('.af-dr-ladder-team')?.textContent} ${li.querySelector('.af-dr-ladder-amt')?.textContent}`,
  )

describe('AuctionBidLadder', () => {
  it('lists one player\'s bids newest first, the top rung marked', () => {
    render(<AuctionBidLadder bids={ladderFor(HISTORY, BIJAN)} playerName="Bijan Robinson" nameOf={names} />)
    const ladder = screen.getByTestId('auction-bid-ladder')
    expect(rungs(ladder)).toEqual(['Beta $40', 'Gamma $35', 'Beta $30', 'Alpha $25'])
    expect(ladder.querySelector('[data-top="true"] .af-dr-ladder-amt')?.textContent).toBe('$40')
    expect(ladder.querySelector('time')?.getAttribute('dateTime')).toBe('2026-11-06T18:00:40Z')
  })

  it('renders nothing with no rows', () => {
    const { container } = render(<AuctionBidLadder bids={[]} playerName="Bijan Robinson" nameOf={names} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('AuctionSpotlightPanel bid history', () => {
  it('shows the ladder for the player on the block and for each recently sold player', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ bids: HISTORY }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuctionSpotlightPanel {...panel} />)
    const block = await screen.findByTestId('auction-block-ladder')
    expect(rungs(block)).toEqual(['Beta $40', 'Gamma $35', 'Beta $30', 'Alpha $25'])
    const won = screen.getByTestId('auction-won-ladder')
    expect(won.querySelector('summary')?.textContent).toBe('Bid history · 2 bids')
    expect(rungs(won)).toEqual(['Beta $50', 'Alpha $45'])
    expect(fetchMock).toHaveBeenCalledWith('/api/leagues/lg-1/draft/auction/bids', { cache: 'no-store' })
  })

  it('renders no ladder and no empty box when the history is empty (or the table is missing)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ bids: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<AuctionSpotlightPanel {...panel} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.querySelector('.af-dr-ladder')).toBeNull()
    expect(screen.queryByTestId('auction-won-ladder')).toBeNull()
    expect(screen.getByTestId('auction-recently-won').textContent).toContain('Beta Back')
  })

  it('renders no ladder when the read fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network')
    })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<AuctionSpotlightPanel {...panel} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.querySelector('.af-dr-ladder')).toBeNull()
  })

  it('reads nothing without a league id', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<AuctionSpotlightPanel {...panel} leagueId={null} />)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
