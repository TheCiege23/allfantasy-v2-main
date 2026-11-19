import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import ChimmyActionCard from '@/components/chimmy/ChimmyActionCard'
import { readActionCards, type ChimmyActionCard as Card } from '@/lib/chimmy-chat/actionCards'

/*
 * A league-settings confirm card in the browser (stage 5, 2026-11-16): each setting before → after,
 * and once the season has started, a SECOND tap — the first one sends nothing.
 */

const CARD: Card = {
  actionId: 's1',
  kind: 'settings',
  token: 'signed.token-value',
  title: 'Change the FAAB budget',
  league: { id: 'L1', name: 'Dynasty Ten', sport: 'NFL' },
  week: 0,
  season: 2026,
  expiresAt: '2099-01-01T00:00:00.000Z',
  settings: { changes: [{ label: 'FAAB budget', from: '$100', to: '$200' }], midSeason: false },
  warnings: [],
}
const MID: Card = {
  ...CARD,
  actionId: 's2',
  settings: { changes: [{ label: 'Trade review period', from: '48 hours', to: '24 hours' }], midSeason: true },
  warnings: ['The season has started. This applies from now on, to every team, and is announced in the league. Tap Confirm, then confirm again.'],
}
const done = { ok: true, status: 'executed' as const, kind: 'settings' as const, message: 'Saved — FAAB budget is now $200.' }

afterEach(cleanup)

describe('settings confirm card', () => {
  it('shows each setting before → after, and one tap saves', async () => {
    const confirm = vi.fn(async () => done)
    render(<ChimmyActionCard card={CARD} confirm={confirm} />)
    expect(screen.getByTestId('chimmy-action-settings').textContent).toBe('FAAB budget: $100 → $200')
    fireEvent.click(screen.getByTestId('chimmy-action-confirm'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Saved — FAAB budget is now \$200/))
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('🛑 mid-season: the first tap sends nothing and asks again; the second saves', async () => {
    const confirm = vi.fn(async () => done)
    render(<ChimmyActionCard card={MID} confirm={confirm} />)
    expect(screen.getByTestId('chimmy-action-warnings').textContent).toMatch(/season has started/)
    fireEvent.click(screen.getByTestId('chimmy-action-confirm'))
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.getByTestId('chimmy-action-second-tap').textContent).toMatch(/Tap again/)
    expect(screen.getByTestId('chimmy-action-confirm').textContent).toBe('Yes — change it mid-season')
    fireEvent.click(screen.getByTestId('chimmy-action-confirm'))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
  })

  it('is read back from an answer, and a malformed one is dropped', () => {
    const [read] = readActionCards({ actionCards: [MID] })
    expect(read).toMatchObject({ kind: 'settings', settings: { midSeason: true, changes: [{ label: 'Trade review period', from: '48 hours', to: '24 hours' }] } })
    expect(readActionCards({ actionCards: [{ ...CARD, settings: { changes: [{ label: 'x' }], midSeason: false } }] })).toEqual([])
  })
})
