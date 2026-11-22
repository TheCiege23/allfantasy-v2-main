import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import ChimmyActionCard from '@/components/chimmy/ChimmyActionCard'
import ChimmyActionCardTray from '@/components/chimmy/ChimmyActionCardTray'
import { publishChimmyActionCards, resetChimmyActionCardsForTest, type ChimmyActionCard as Card } from '@/lib/chimmy-chat/actionCards'
import { DRAFT_QUEUE_CHANGED_EVENT } from '@/lib/draft-room/draftQueueChangedEvent'

/*
 * A draft-queue confirm card in the browser (stage 2 of drafts, 2026-11-16), the tray that finally
 * renders cards on ChimmyChatShell surfaces, and the event that makes an open draft room reload.
 */

const QUEUE_CARD: Card = {
  actionId: 'q1',
  kind: 'queue',
  token: 'signed.token-value',
  title: 'Put Jaylen Waddle at the top of your queue',
  league: { id: 'L1', name: 'KBFL', sport: 'NFL' },
  week: 0,
  season: 2026,
  expiresAt: '2099-01-01T00:00:00.000Z',
  queue: {
    add: [{ name: 'Jaylen Waddle', position: 'WR', team: 'MIA' }],
    addAt: 'top',
    remove: [{ name: 'Travis Kelce', position: 'TE', team: 'KC' }],
    resultingTop: ['Jaylen Waddle', 'Puka Nacua'],
  },
  warnings: ['Your queue only: this never makes a pick.'],
}

beforeEach(() => resetChimmyActionCardsForTest())
afterEach(() => cleanup())

describe('the queue card', () => {
  it('shows exactly what changes in the queue, and that it never makes a pick', () => {
    render(<ChimmyActionCard card={QUEUE_CARD} />)
    const body = screen.getByTestId('chimmy-action-queue').textContent
    expect(body).toContain('Queue first Jaylen Waddle (WR · MIA)')
    expect(body).toContain('Take off Travis Kelce (TE · KC)')
    expect(body).toContain('Your queue will start: 1. Jaylen Waddle · 2. Puka Nacua')
    expect(screen.getByTestId('chimmy-action-warnings').textContent).toContain('never makes a pick')
    expect(screen.getByTestId('chimmy-action-confirm').textContent).toBe('Confirm — save queue')
  })

  it('🛑 tells an open draft room to reload its queue once the save is confirmed — and not before', async () => {
    const heard: unknown[] = []
    const listener = (e: Event) => heard.push((e as CustomEvent).detail)
    window.addEventListener(DRAFT_QUEUE_CHANGED_EVENT, listener)
    try {
      const refused = vi.fn(async () => ({ ok: false, status: 'refused' as const, message: 'Your queue changed since this card was made.' }))
      const { unmount } = render(<ChimmyActionCard card={QUEUE_CARD} confirm={refused} />)
      fireEvent.click(screen.getByTestId('chimmy-action-confirm'))
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/queue changed/))
      expect(heard).toEqual([])
      unmount()

      const ok = vi.fn(async () => ({ ok: true, status: 'executed' as const, kind: 'queue' as const, message: 'Queue saved — Jaylen Waddle at the top.' }))
      render(<ChimmyActionCard card={QUEUE_CARD} confirm={ok} />)
      fireEvent.click(screen.getByTestId('chimmy-action-confirm'))
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Queue saved'))
      expect(heard).toEqual([{ leagueId: 'L1' }])
    } finally {
      window.removeEventListener(DRAFT_QUEUE_CHANGED_EVENT, listener)
    }
  })
})

describe('the card tray', () => {
  it('renders cards an answer published, only for its own league, and lets one be dismissed', async () => {
    render(<ChimmyActionCardTray leagueId="L1" />)
    expect(screen.queryByTestId('chimmy-action-card-tray')).toBeNull()
    act(() => publishChimmyActionCards([QUEUE_CARD, { ...QUEUE_CARD, actionId: 'q2', league: { id: 'OTHER', name: 'Other', sport: 'NFL' } }]))
    const cards = await screen.findAllByTestId('chimmy-action-card')
    expect(cards).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByTestId('chimmy-action-card')).toBeNull()
  })
})
