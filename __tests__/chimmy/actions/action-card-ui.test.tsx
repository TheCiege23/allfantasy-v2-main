import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import ChimmyActionCard from '@/components/chimmy/ChimmyActionCard'
import ChimmyActionCardTray from '@/components/chimmy/ChimmyActionCardTray'
import {
  confirmChimmyActionCard,
  publishChimmyActionCards,
  readActionCards,
  resetChimmyActionCardsForTest,
  type ChimmyActionCard as Card,
} from '@/lib/chimmy-chat/actionCards'

/**
 * The card in the browser. The contract: it shows exactly what will change, and the ONLY request it
 * ever makes is the Confirm tap — which sends the token and nothing else.
 */

const FUTURE = '2099-01-01T00:00:00.000Z'
const LINEUP: Card = {
  actionId: 'a1',
  kind: 'lineup',
  token: 'signed.token-value',
  title: 'Lineup change — Week 4',
  league: { id: 'L1', name: 'KBFL', sport: 'NFL' },
  week: 4,
  season: 2026,
  expiresAt: FUTURE,
  lineup: {
    moveIn: [{ name: 'Kyren Williams', position: 'RB', team: 'LAR', slot: 'RB2' }],
    moveOut: [{ name: 'Tony Pollard', position: 'RB', team: 'TEN' }],
  },
  warnings: ['Kyren Williams is listed Questionable.'],
}
const TRADE: Card = {
  ...LINEUP,
  actionId: 'a2',
  kind: 'trade',
  title: 'Trade offer to Jordan',
  lineup: undefined,
  trade: { partnerTeamName: 'Jordan', youGive: [{ name: "Ja'Marr Chase", position: 'WR', team: 'CIN' }], youGet: [{ name: 'Justin Jefferson', position: 'WR', team: 'MIN' }], reviewNote: 'If they accept, your commissioner reviews it before it processes.' },
  warnings: [],
}

beforeEach(() => resetChimmyActionCardsForTest())
afterEach(() => cleanup())

describe('ChimmyActionCard', () => {
  it('shows what moves where, the league and week, and every warning — and changes nothing on render', () => {
    const confirm = vi.fn()
    render(<ChimmyActionCard card={LINEUP} confirm={confirm} />)
    expect(screen.getByText(/Start/)).toHaveTextContent('Start Kyren Williams (RB · LAR) in RB2')
    expect(screen.getByText(/Bench/)).toHaveTextContent('Bench Tony Pollard (RB · TEN)')
    expect(screen.getByText('KBFL · NFL · Week 4')).toBeInTheDocument()
    expect(screen.getByText('Kyren Williams is listed Questionable.')).toBeInTheDocument()
    expect(screen.getByText('Nothing changes until you tap Confirm.')).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('confirms once, then shows the result and cannot be tapped again', async () => {
    const confirm = vi.fn(async () => ({ ok: true, status: 'executed' as const, message: 'Done — started Kyren Williams and benched Tony Pollard for week 4.' }))
    render(<ChimmyActionCard card={LINEUP} confirm={confirm} />)
    fireEvent.click(screen.getByTestId('chimmy-action-confirm'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Done — started Kyren Williams/))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('chimmy-action-confirm')).toBeNull()
  })

  it('keeps a definitive refusal final, but lets a lost response be retried', async () => {
    const confirm = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 'refused', retryable: true, message: "Couldn't reach AllFantasy." })
      .mockResolvedValueOnce({ ok: false, status: 'refused', message: "Nothing was changed: Tony Pollard's game has already started." })
    render(<ChimmyActionCard card={LINEUP} confirm={confirm} />)
    fireEvent.click(screen.getByTestId('chimmy-action-confirm'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Couldn't reach/))
    expect(screen.getByTestId('chimmy-action-confirm')).not.toBeDisabled()
    fireEvent.click(screen.getByTestId('chimmy-action-confirm'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/already started/))
    expect(screen.getByTestId('chimmy-action-confirm')).toBeDisabled()
  })

  it('will not confirm an expired card', () => {
    const confirm = vi.fn()
    render(<ChimmyActionCard card={{ ...LINEUP, expiresAt: '2000-01-01T00:00:00.000Z' }} confirm={confirm} />)
    expect(screen.getByTestId('chimmy-action-confirm')).toBeDisabled()
    fireEvent.click(screen.getByTestId('chimmy-action-confirm'))
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.getByText(/This card expired/)).toBeInTheDocument()
  })

  it('renders a trade offer with both sides and the review note', () => {
    render(<ChimmyActionCard card={TRADE} confirm={vi.fn()} />)
    expect(screen.getByText("Ja'Marr Chase (WR · CIN)")).toBeInTheDocument()
    expect(screen.getByText('Justin Jefferson (WR · MIN)')).toBeInTheDocument()
    expect(screen.getByText(/commissioner reviews it/)).toBeInTheDocument()
    expect(screen.getByTestId('chimmy-action-confirm')).toHaveTextContent('Confirm — send offer')
  })
})

describe('confirmChimmyActionCard', () => {
  it('POSTs the token and NOTHING else', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, status: 'executed', message: 'Done.' }), { status: 200 }))
    const r = await confirmChimmyActionCard(LINEUP, fetchImpl as unknown as typeof fetch)
    expect(r).toMatchObject({ ok: true, status: 'executed' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/chimmy/actions/confirm')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ token: 'signed.token-value' })
  })

  it('treats a network failure as retryable, never as "nothing changed"', async () => {
    const r = await confirmChimmyActionCard(LINEUP, (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch)
    expect(r).toMatchObject({ ok: false, retryable: true })
    expect(r.message).not.toMatch(/nothing was changed/i)
  })
})

describe('readActionCards and the tray', () => {
  it('keeps only well-formed cards', () => {
    expect(readActionCards({ actionCards: [LINEUP, { kind: 'lineup' }, { ...TRADE, trade: { youGive: [], youGet: [] } }, 'x'] })).toEqual([LINEUP])
    expect(readActionCards({})).toEqual([])
    expect(readActionCards(null)).toEqual([])
  })

  it('shows published cards newest first and lets one be dismissed', async () => {
    render(<ChimmyActionCardTray />)
    expect(screen.queryByTestId('chimmy-action-tray')).toBeNull()
    act(() => publishChimmyActionCards([LINEUP]))
    act(() => publishChimmyActionCards([TRADE, LINEUP]))
    const cards = screen.getAllByTestId('chimmy-action-card')
    expect(cards.map((c) => c.getAttribute('data-action-kind'))).toEqual(['trade', 'lineup'])
    fireEvent.click(screen.getAllByLabelText('Dismiss')[0]!)
    expect(screen.getAllByTestId('chimmy-action-card')).toHaveLength(1)
  })
})
