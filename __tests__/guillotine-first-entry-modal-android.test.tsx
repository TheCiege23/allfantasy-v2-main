// @vitest-environment jsdom
/**
 * Android invitees accepted a Guillotine league invite and found the page "frozen": the first-entry
 * intro modal covers the whole page and closed itself ONLY on the video's `ended` event. Android
 * in-app browsers and data/battery saver block muted autoplay, so `ended` never fired. The modal must
 * get out of the way when playback never starts, and must always offer a visible way out.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GuillotineFirstEntryModal } from '@/components/guillotine/GuillotineFirstEntryModal'

describe('GuillotineFirstEntryModal on a browser that blocks autoplay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('dismisses itself when the video never starts playing (no `ended` will ever fire)', () => {
    const onClose = vi.fn()
    render(<GuillotineFirstEntryModal leagueId="L-android-1" show onClose={onClose} />)
    expect(screen.getByRole('dialog')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(4100)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stays up while the video is actually playing, then closes when it ends', () => {
    const onClose = vi.fn()
    const { container } = render(<GuillotineFirstEntryModal leagueId="L-android-2" show onClose={onClose} />)
    const video = container.querySelector('video')!
    fireEvent.playing(video)
    act(() => {
      vi.advanceTimersByTime(4100)
    })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.ended(video)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('always has a close button outside the video card, and it marks the intro seen', () => {
    const onClose = vi.fn()
    const first = render(<GuillotineFirstEntryModal leagueId="L-android-3" show onClose={onClose} />)
    fireEvent.click(screen.getByTestId('guillotine-intro-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
    first.unmount()

    render(<GuillotineFirstEntryModal leagueId="L-android-3" show onClose={onClose} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not reappear on every visit when localStorage throws (WebView with storage off)', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    try {
      const onClose = vi.fn()
      const first = render(<GuillotineFirstEntryModal leagueId="L-android-4" show onClose={onClose} />)
      fireEvent.click(screen.getByTestId('guillotine-intro-enter'))
      first.unmount()
      render(<GuillotineFirstEntryModal leagueId="L-android-4" show onClose={onClose} />)
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })
})
