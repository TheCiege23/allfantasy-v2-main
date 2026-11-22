import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import ShareChimmyAnswerButton, { isShareableChimmyAnswer } from '@/components/chat/ShareChimmyAnswerButton'

/* The "Share with league" button under a private @chimmy answer (2026-11-16). */

afterEach(cleanup)

describe('ShareChimmyAnswerButton', () => {
  it('says the answer is private until shared, and shares on a tap', async () => {
    const onShare = vi.fn(async () => true)
    render(<ShareChimmyAnswerButton shared={false} onShare={onShare} />)
    expect(screen.getByTestId('chimmy-share-note').textContent).toBe('Only you see this until you share it.')
    fireEvent.click(screen.getByTestId('chimmy-share-button'))
    await waitFor(() => expect(onShare).toHaveBeenCalledTimes(1))
  })

  it('says so when sharing failed, and keeps the button', async () => {
    render(<ShareChimmyAnswerButton shared={false} onShare={async () => false} />)
    fireEvent.click(screen.getByTestId('chimmy-share-button'))
    await waitFor(() => expect(screen.getByTestId('chimmy-share-note').textContent).toBe('Could not share it. Try again.'))
    expect(screen.getByTestId('chimmy-share-button')).toBeTruthy()
  })

  it('an answer already shared shows that, with no button', () => {
    render(<ShareChimmyAnswerButton shared onShare={async () => true} />)
    expect(screen.getByTestId('chimmy-share-done').textContent).toBe('Shared with your league')
    expect(screen.queryByTestId('chimmy-share-button')).toBeNull()
  })

  it('only a private answer marked shareable gets the button', () => {
    expect(isShareableChimmyAnswer({ chimmyPrivateReply: true, chimmyShareable: true })).toBe(true)
    expect(isShareableChimmyAnswer({ chimmyPrivateReply: true })).toBe(false)
    expect(isShareableChimmyAnswer({ chimmyShareable: true })).toBe(false)
    expect(isShareableChimmyAnswer(null)).toBe(false)
  })
})
