/**
 * "Trade for this pick" in the room (owner's rule, 2026-11-26):
 *   - the board draws the action only on another team's upcoming pick, and only when the caller passes it
 *     (the caller passes it only for a slow, non-auction draft — `tradeForPickDraftEligible`);
 *   - the composer opens PREFILLED with that pick on their side, asks the existing suggestions route for
 *     `for_their_pick`, shows at most three offers with THE grade, shows the chosen offer's grade before
 *     sending, and sends through the existing proposal route.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/app/draft-room/LazyDraftImage', () => ({ LazyDraftImage: () => null }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ canUse: () => false }) }))

import { DraftBoard } from '@/components/app/draft-room/DraftBoard'
import { DraftPickTradePanel } from '@/components/app/draft-room/DraftPickTradePanel'
import type { DraftPickSnapshot, SlotOrderEntry } from '@/lib/live-draft-engine/types'

const slotOrder: SlotOrderEntry[] = [
  { slot: 1, rosterId: 'ra', displayName: 'Alpha' },
  { slot: 2, rosterId: 'rb', displayName: 'Beta' },
  { slot: 3, rosterId: 'rc', displayName: 'Gamma' },
]
const made: DraftPickSnapshot = {
  id: 'p2', overall: 2, round: 1, slot: 2, rosterId: 'rb', displayName: 'Beta', playerName: 'Made Guy', position: 'RB',
  team: 'NYJ', byeWeek: null, playerId: 'x', tradedPickMeta: null, source: 'user', pickLabel: '1.02', createdAt: new Date().toISOString(),
}

describe('the board', () => {
  const renderBoard = (onTradeForPick?: (c: unknown) => void, picks: DraftPickSnapshot[] = []) =>
    render(
      <DraftBoard
        picks={picks}
        slotOrder={slotOrder}
        teamCount={3}
        rounds={2}
        draftType="snake"
        thirdRoundReversal={false}
        currentOverallPick={1}
        currentUserRosterId="ra"
        onCellTrade={() => {}}
        onTradeForPick={onTradeForPick as never}
      />,
    )

  it('another team’s upcoming pick gets the action; my own picks and made picks do not', () => {
    const spy = vi.fn()
    renderBoard(spy, [made])
    // Snake, 3 teams: Beta holds #2 (made) and #5; Gamma #3 and #4; Alpha #1 and #6.
    expect(screen.queryByTestId('draft-board-cell-trade-for-pick-2')).toBeNull() // made
    expect(screen.queryByTestId('draft-board-cell-trade-for-pick-1')).toBeNull() // mine
    expect(screen.queryByTestId('draft-board-cell-trade-for-pick-6')).toBeNull() // mine
    const btn = screen.getByTestId('draft-board-cell-trade-for-pick-5')
    expect(btn.textContent).toBe('Trade for this pick')
    expect(btn.className).toMatch(/min-h-\[44px\]/)
    expect(btn.className).toMatch(/inset-0/) // the whole 68px tile is the target
    // The corner icon on that tile is gone: one control, not two.
    expect(screen.queryByTestId('draft-board-cell-trade-5')).toBeNull()
    fireEvent.click(btn)
    expect(spy).toHaveBeenCalledWith({ round: 2, slot: 2, overall: 5, ownerRosterId: 'rb' })
  })

  it('without the caller’s go-ahead (fast draft, auction, trades off) no tile carries it', () => {
    renderBoard(undefined)
    expect(document.querySelector('[data-testid^="draft-board-cell-trade-for-pick-"]')).toBeNull()
  })
})

describe('the composer, opened for their pick', () => {
  const calls: Array<{ url: string; body: any }> = []
  const offer = (giveRound: number, letter: string, partnerLetter: string, giveValue: number) => ({
    id: `o${giveRound}`, suggestionKind: 'for_their_pick', giveRound, giveSlot: 1, receiveRound: 2, receiveSlot: 2, rationale: 'r',
    tradeGrade: { graded: true, letter, partnerLetter, label: 'label', giveValue, getValue: 3000, recommendation: '' },
  })
  beforeEach(() => {
    calls.length = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ url, body })
      const ok = (data: unknown) => ({ ok: true, json: async () => data })
      if (url.endsWith('/trade-builder/inventory')) {
        return ok({
          mine: [{ overall: 1, round: 1, slot: 1 }, { overall: 6, round: 2, slot: 1 }, { overall: 7, round: 3, slot: 1 }],
          byRosterId: { rb: [{ overall: 5, round: 2, slot: 2 }] },
          draftInProgress: true,
        })
      }
      if (url.endsWith('/trade-builder/suggestions')) return ok({ ok: true, suggestions: [offer(3, 'C', 'C', 3050), offer(2, 'D', 'B', 4200), offer(1, 'F', 'A', 6000), offer(4, 'A', 'F', 900)] })
      if (url.endsWith('/trade-proposals') && init?.method === 'POST') return ok({ ok: true })
      if (url.endsWith('/trade-proposals')) return ok({ proposals: [] })
      return ok({})
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('prefills their pick, shows ≤3 offers ranked by grade with the chosen grade, and sends through the existing route', async () => {
    render(
      <DraftPickTradePanel
        leagueId="L1"
        slotOrder={slotOrder}
        teamCount={3}
        rounds={3}
        currentUserRosterId="ra"
        onClose={() => {}}
        tradePanelGeneration={1}
        initialTradeDraft={{ receiveRound: 2, receiverRosterId: 'rb', targetPick: { round: 2, slot: 2, overall: 5 } }}
      />,
    )
    const card = await screen.findByTestId('trade-for-pick-card')
    expect(card.textContent).toMatch(/Beta's 2\.02/)
    await waitFor(() => expect(within(card).getAllByRole('button')).toHaveLength(3))
    const ask = calls.find((c) => c.url.endsWith('/trade-builder/suggestions'))!
    expect(ask.body).toMatchObject({ partnerRosterId: 'rb', suggestionKind: 'for_their_pick', anchorReceiveRound: 2, anchorReceiveSlot: 2 })
    // The route's order (closest to even first) is kept; the best is in the composer with its grade shown.
    expect(within(card).getAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual([
      'trade-for-pick-offer-3-1', 'trade-for-pick-offer-2-1', 'trade-for-pick-offer-1-1',
    ])
    await waitFor(() => expect(within(card).getByTestId('draft-trade-grade').textContent).toMatch(/League grade: You C · Beta C/))
    // Choose another offer: its grade replaces the first, before anything is sent.
    fireEvent.click(within(card).getByTestId('trade-for-pick-offer-2-1'))
    await waitFor(() => expect(within(card).getByTestId('draft-trade-grade').textContent).toMatch(/You D · Beta B/))
    expect(calls.some((c) => c.url.endsWith('/trade-proposals') && c.body)).toBe(false)
    const send = screen.getByTestId('draft-trade-send-offer')
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(send)
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/trade-proposals') && c.body)).toBe(true))
    const sent = calls.find((c) => c.url.endsWith('/trade-proposals') && c.body)!
    expect(sent.url).toBe('/api/leagues/L1/draft/trade-proposals')
    expect(sent.body).toMatchObject({ giveRound: 2, giveSlot: 1, receiveRound: 2, receiveSlot: 2, receiverRosterId: 'rb' })
  })
})
