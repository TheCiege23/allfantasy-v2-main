/**
 * The "You're up" alert in the draft room (2026-11-24, the simplify pass): two lines, not three, and no
 * "See players" button when the player list is already on screen (the phone's Players tab).
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { YoureUpAlert } from '@/components/app/draft-room/YoureUpAlert'

afterEach(cleanup)

const base = {
  pickLabel: '1.02',
  timed: true,
  suggestion: { name: 'Atlas Runner', position: 'RB', source: 'queue' as const },
  backToBackLabel: null,
  drafting: false,
  canDraft: true,
  onDraftSuggestion: vi.fn(),
  onSeePlayers: vi.fn(),
  onDismiss: vi.fn(),
}

describe('YoureUpAlert', () => {
  it('says the pick and the suggestion, not that the clock is running (the header shows the clock)', () => {
    render(<YoureUpAlert {...base} />)
    const alert = screen.getByTestId('draft-youre-up-alert')
    expect(alert.textContent).not.toContain('Your pick clock is running')
    expect(screen.getByTestId('draft-youre-up-detail').textContent).toBe('Top of your queue: Atlas Runner · RB.')
    expect(screen.getByTestId('draft-youre-up-draft').textContent).toBe('Draft Atlas Runner')
    expect(screen.getByTestId('draft-youre-up-see-players')).toBeTruthy()
  })

  it('keeps the back-to-back warning on the same line', () => {
    render(<YoureUpAlert {...base} backToBackLabel="1.03" />)
    expect(screen.getByTestId('draft-youre-up-detail').textContent).toBe('Top of your queue: Atlas Runner · RB. You pick again at 1.03 — back-to-back.')
  })

  it('on the Players tab there is no "See players" button, and no empty button row', () => {
    const { container, rerender } = render(<YoureUpAlert {...base} playersOnScreen />)
    expect(screen.queryByTestId('draft-youre-up-see-players')).toBeNull()
    expect(screen.getByTestId('draft-youre-up-draft')).toBeTruthy()
    rerender(<YoureUpAlert {...base} suggestion={null} playersOnScreen />)
    expect(container.querySelectorAll('button').length).toBe(1) // dismiss only
  })
})
