/**
 * Draft room redesign (2026-11-02): the mode banner (offline / auto-pick / mock), the pick-clock
 * progress bar, and the auction "on the block" panel — viewer stats, quick bids capped at the
 * server's max-bid rule, recently won and budgets. Copy comes from
 * lib/core-app/messages/draftRoomRedesign.ts in English and Spanish.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.language, t: (k: string) => k }),
  useLanguage: () => ({ language: lang.language, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))

import { DraftModeBanner, resolveDraftRoomMode } from '@/components/app/draft-room/DraftModeBanner'
import {
  AuctionSpotlightPanel,
  buildAuctionTeamLines,
  nominationTurnsUntil,
} from '@/components/app/draft-room/AuctionSpotlightPanel'
import { clockProgressPercent } from '@/components/app/draft-room/DraftTopBar'
import type { AuctionSessionSnapshot, DraftPickSnapshot } from '@/lib/live-draft-engine/types'

afterEach(cleanup)
beforeEach(() => {
  lang.language = 'en'
})

describe('resolveDraftRoomMode', () => {
  it('mock wins, then offline, then the viewer auto-pick', () => {
    expect(resolveDraftRoomMode({ isMock: true, executionMode: 'offline', viewerAutopickEnabled: true })).toBe('mock')
    expect(resolveDraftRoomMode({ executionMode: 'offline', viewerAutopickEnabled: true })).toBe('offline')
    expect(resolveDraftRoomMode({ executionMode: 'live', viewerAutopickEnabled: true })).toBe('autopick')
    expect(resolveDraftRoomMode({ executionMode: 'live', viewerAutopickEnabled: false })).toBeNull()
  })
})

describe('DraftModeBanner', () => {
  it('renders nothing without a mode', () => {
    const { container } = render(<DraftModeBanner mode={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('tells the commissioner they are logging picks, and members who is', () => {
    render(<DraftModeBanner mode="offline" isCommissioner />)
    expect(screen.getByTestId('draft-room-offline-banner').textContent).toContain('You are logging picks from an in-person draft')
    cleanup()
    render(<DraftModeBanner mode="offline" />)
    expect(screen.getByTestId('draft-room-offline-banner').textContent).toContain('The commissioner records each pick')
  })

  it('reads Spanish', () => {
    lang.language = 'es'
    render(<DraftModeBanner mode="autopick" />)
    const text = screen.getByTestId('draft-room-autopick-banner').textContent ?? ''
    expect(text).toContain('El auto-pick está activado')
    expect(text).toContain('empezando por tu cola')
  })
})

describe('clockProgressPercent', () => {
  it('is the share of the pick clock left, clamped', () => {
    expect(clockProgressPercent(45, 90)).toBe(50)
    expect(clockProgressPercent(0, 90)).toBe(0)
    expect(clockProgressPercent(120, 90)).toBe(100)
  })
  it('draws nothing for an untimed draft', () => {
    expect(clockProgressPercent(45, 0)).toBeNull()
    expect(clockProgressPercent(null, 90)).toBeNull()
  })
})

const order = [
  { slot: 1, rosterId: 'r1', displayName: 'Alpha' },
  { slot: 2, rosterId: 'r2', displayName: 'Beta' },
  { slot: 3, rosterId: 'r3', displayName: 'Gamma' },
]

function pick(overall: number, rosterId: string, playerName: string, amount: number | null): DraftPickSnapshot {
  return {
    id: `p${overall}`,
    overall,
    round: 1,
    slot: 1,
    rosterId,
    displayName: order.find((o) => o.rosterId === rosterId)?.displayName ?? null,
    playerName,
    position: 'RB',
    team: 'ATL',
    byeWeek: null,
    playerId: null,
    tradedPickMeta: null,
    source: 'user',
    pickLabel: `1.0${overall}`,
    amount,
    createdAt: '2026-11-01T00:00:00Z',
  }
}

function auction(overrides: Partial<AuctionSessionSnapshot['auctionState']> = {}): AuctionSessionSnapshot {
  return {
    draftType: 'auction',
    budgetPerTeam: 200,
    budgets: { r1: 195, r2: 150, r3: 200 },
    minBidIncrement: 1,
    nominationOrder: order,
    auctionState: {
      nominationOrderIndex: 1,
      currentNomination: { playerName: 'Bijan Robinson', position: 'RB', team: 'ATL', nominatedByRosterId: 'r2' } as never,
      currentBid: 40,
      currentBidderRosterId: 'r2',
      bidTimerEndAt: null,
      minNextBid: 41,
      ...overrides,
    },
  }
}

describe('buildAuctionTeamLines', () => {
  it('max bid keeps the minimum bid in reserve for every open spot after this one', () => {
    const lines = buildAuctionTeamLines({
      auction: auction(),
      rosterSize: 15,
      picks: [pick(1, 'r1', 'A. Atlas', 5), pick(2, 'r2', 'B. Beta', 50)],
      minimumBid: 1,
    })
    const alpha = lines.find((l) => l.rosterId === 'r1')!
    expect(alpha).toMatchObject({ left: 195, spots: 14, max: 182 })
    expect(lines.find((l) => l.rosterId === 'r2')).toMatchObject({ left: 150, spots: 14, max: 137 })
    expect(lines.find((l) => l.rosterId === 'r3')).toMatchObject({ spots: 15, max: 186, leftPct: 100 })
  })

  it('draws no max and no spots when the roster size is unknown', () => {
    const lines = buildAuctionTeamLines({ auction: auction(), rosterSize: null, picks: [] })
    expect(lines[0]).toMatchObject({ max: null, spots: null })
  })
})

describe('nominationTurnsUntil', () => {
  it('counts turns around the order, and a live nomination of your own is a full lap away', () => {
    expect(nominationTurnsUntil({ order, currentIndex: 1, viewerRosterId: 'r3', nominationLive: true })).toBe(1)
    expect(nominationTurnsUntil({ order, currentIndex: 1, viewerRosterId: 'r1', nominationLive: true })).toBe(2)
    expect(nominationTurnsUntil({ order, currentIndex: 0, viewerRosterId: 'r1', nominationLive: false })).toBe(0)
    expect(nominationTurnsUntil({ order, currentIndex: 0, viewerRosterId: 'r1', nominationLive: true })).toBe(3)
    expect(nominationTurnsUntil({ order, currentIndex: 0, viewerRosterId: null, nominationLive: false })).toBeNull()
  })
})

describe('AuctionSpotlightPanel', () => {
  const base = {
    currentUserRosterId: 'r1',
    isCommissioner: false,
    onNominate: () => {},
    onResolve: () => {},
    timerRemainingSeconds: 8,
    timerStatus: 'running' as const,
    rosterSize: 15,
    picks: [pick(1, 'r1', 'Atlas Runner', 5), pick(2, 'r2', 'Beta Back', 50)],
  }

  it('shows the viewer budget, max bid and nomination turn', () => {
    render(<AuctionSpotlightPanel {...base} auction={auction()} onBid={() => {}} />)
    expect(screen.getByTestId('auction-viewer-stats').textContent).toContain('$195 of $200')
    expect(screen.getByTestId('auction-viewer-max-bid').textContent).toBe('$182')
    expect(screen.getByTestId('auction-viewer-nominate-in').textContent).toBe('In 2 turns')
    expect(screen.getByTestId('auction-highest-bidder').textContent).toBe('High bidder: Beta')
    expect(screen.getByTestId('auction-current-nominator').textContent).toContain('Beta')
  })

  it('quick bids bid the current bid plus one and plus five', () => {
    const onBid = vi.fn()
    render(<AuctionSpotlightPanel {...base} auction={auction()} onBid={onBid} />)
    fireEvent.click(screen.getByTestId('auction-quick-bid-1'))
    fireEvent.click(screen.getByTestId('auction-quick-bid-5'))
    expect(onBid.mock.calls).toEqual([[41], [45]])
  })

  it('disables a quick bid above the server max', () => {
    render(<AuctionSpotlightPanel {...base} auction={auction({ currentBid: 180, minNextBid: 181 })} onBid={() => {}} />)
    expect((screen.getByTestId('auction-quick-bid-1') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId('auction-quick-bid-5') as HTMLButtonElement).disabled).toBe(true)
  })

  it('lists recent winning bids and every budget', () => {
    render(<AuctionSpotlightPanel {...base} auction={auction()} onBid={() => {}} />)
    const won = screen.getByTestId('auction-recently-won').textContent ?? ''
    expect(won.indexOf('Beta Back')).toBeLessThan(won.indexOf('Atlas Runner'))
    expect(won).toContain('$50')
    const budgets = screen.getByTestId('auction-budgets').textContent ?? ''
    expect(budgets).toContain('$195')
    expect(budgets).toContain('14 spots')
  })

  it('reads Spanish', () => {
    lang.language = 'es'
    render(<AuctionSpotlightPanel {...base} auction={auction()} onBid={() => {}} />)
    expect(screen.getByTestId('auction-viewer-stats').textContent).toContain('$195 de $200')
    expect(screen.getByTestId('auction-highest-bidder').textContent).toBe('Puja más alta: Beta')
    expect(screen.getByText('Ganados recientemente')).toBeTruthy()
  })
})
