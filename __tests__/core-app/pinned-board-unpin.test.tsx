import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PinnedBoard } from '@/components/core-app/comms/PinnedBoard'

/*
 * Every member reads the pinned board; only the commissioner and co-commissioners clear it
 * (2026-10-31). The conversation passes `onUnpin` only to them, and the board draws no × without it.
 */
const pins = [{ pinId: 'p1', messageId: 'm1', snippet: 'Dues by Week 10', pinnedBy: 'Commish', pinnedAt: '2026-10-31T16:00:00Z' }]

describe('PinnedBoard', () => {
  it('shows a member the pins, with no way to unpin them', () => {
    render(<PinnedBoard pins={pins} onJump={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /1 pinned/ }))
    expect(screen.getByText('Dues by Week 10')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Unpin this message' })).toBeNull()
  })

  it('gives whoever runs the chat an unpin button', () => {
    const onUnpin = vi.fn()
    render(<PinnedBoard pins={pins} onJump={vi.fn()} onUnpin={onUnpin} />)
    fireEvent.click(screen.getByRole('button', { name: /1 pinned/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Unpin this message' }))
    expect(onUnpin).toHaveBeenCalledWith('p1')
  })
})
