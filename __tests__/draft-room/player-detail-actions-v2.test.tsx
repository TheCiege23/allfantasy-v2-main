/**
 * Room v2 player card: star, + Queue and Draft sit in one header row, every button 44px tall (a phone
 * touch target), and each does its job.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/app/draft-room/PlayerAvatar', () => ({ PlayerAvatar: () => null }))

import { PlayerDetailModal } from '@/components/app/draft-room/PlayerDetailModal'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const player = { id: 'p-1', name: 'Granite Back', position: 'RB', team: 'DET', byeWeek: 8, adp: 28.4 }

function renderCard(extra: Partial<React.ComponentProps<typeof PlayerDetailModal>> = {}) {
  const handlers = { onMakePick: vi.fn(), onAddToQueue: vi.fn(), onToggleWatchlist: vi.fn() }
  render(<PlayerDetailModal open onClose={() => {}} player={player} sport="NFL" canDraft {...handlers} {...extra} />)
  return handlers
}

describe('room v2 player card actions', () => {
  it('groups star, + Queue and Draft, each 44px tall: a row on phones, a column from md', () => {
    renderCard()
    const row = screen.getByTestId('player-detail-actions')
    for (const id of ['player-detail-watchlist', 'player-detail-queue', 'player-detail-draft']) {
      const button = screen.getByTestId(id)
      expect(row.contains(button)).toBe(true)
      expect(button.className).toContain('h-11')
    }
    expect(row.className).toContain('flex-row')
    expect(row.className).toContain('md:flex-col')
    // Visual order star → Queue → Draft, whatever the source order.
    expect(screen.getByTestId('player-detail-watchlist').className).toContain('order-1')
    expect(screen.getByTestId('player-detail-queue').className).toContain('order-2')
    expect(screen.getByTestId('player-detail-draft').className).toContain('order-3')
  })

  it('each button calls its handler', () => {
    const h = renderCard()
    fireEvent.click(screen.getByTestId('player-detail-draft'))
    fireEvent.click(screen.getByTestId('player-detail-queue'))
    fireEvent.click(screen.getByTestId('player-detail-watchlist'))
    expect(h.onMakePick).toHaveBeenCalledTimes(1)
    expect(h.onAddToQueue).toHaveBeenCalledTimes(1)
    expect(h.onToggleWatchlist).toHaveBeenCalledTimes(1)
  })

  it('when it is not your pick, the Draft slot says so at the same height', () => {
    renderCard({ canDraft: false, draftUnavailableReason: 'not_your_pick' })
    expect(screen.queryByTestId('player-detail-draft')).toBeNull()
    const unavailable = screen.getByTestId('player-detail-draft-unavailable')
    expect(unavailable.textContent).toBe('Not your pick')
    expect(unavailable.className).toContain('h-11')
  })
})
