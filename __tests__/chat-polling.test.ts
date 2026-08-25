import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { isNearBottom, useChatPolling } from '@/lib/chat-core/useChatPolling'
import { DEFAULT_POLL_INTERVAL_MS, FAST_POLL_INTERVAL_MS } from '@/lib/chat-core/RealtimeMessageService'

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useChatPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setVisibility('visible')
  })
  afterEach(() => vi.useRealTimers())

  it('refreshes on the idle cadence', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useChatPolling({ refresh, enabled: true }))

    expect(refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('uses the faster cadence while the user is active', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useChatPolling({ refresh, enabled: true, active: true }))

    await vi.advanceTimersByTimeAsync(FAST_POLL_INTERVAL_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no thread is open', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useChatPolling({ refresh, enabled: false }))

    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS * 3)
    expect(refresh).not.toHaveBeenCalled()
  })

  /*
   * A drawer left open in a background tab would otherwise poll every few
   * seconds forever, spending a per-user rate-limit budget the active tab needs.
   */
  it('stops polling while the tab is hidden', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useChatPolling({ refresh, enabled: true }))

    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS * 3)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes immediately on returning to the tab', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useChatPolling({ refresh, enabled: true }))

    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS)
    expect(refresh).not.toHaveBeenCalled()

    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  /*
   * A slow response must not let ticks queue behind it — overlapping requests
   * multiply load exactly when the server is already struggling.
   */
  it('never overlaps two refreshes', async () => {
    let release: (() => void) | null = null
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    renderHook(() => useChatPolling({ refresh, enabled: true }))

    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS)
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS * 2)
    expect(refresh).toHaveBeenCalledTimes(1)

    release?.()
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  /* A failed poll must not surface an error over a working conversation. */
  it('survives a failing refresh and keeps polling', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('offline'))
    renderHook(() => useChatPolling({ refresh, enabled: true }))

    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('stops polling once unmounted', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => useChatPolling({ refresh, enabled: true }))

    unmount()
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS * 3)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('isNearBottom', () => {
  function el(scrollHeight: number, scrollTop: number, clientHeight: number) {
    return { scrollHeight, scrollTop, clientHeight } as HTMLElement
  }

  it('is true at the bottom', () => {
    expect(isNearBottom(el(1000, 800, 200))).toBe(true)
  })

  /* Someone reading history must not be yanked down every few seconds. */
  it('is false when the reader has scrolled up', () => {
    expect(isNearBottom(el(1000, 100, 200))).toBe(false)
  })

  it('allows a little slack so a pixel off the bottom still follows', () => {
    expect(isNearBottom(el(1000, 760, 200))).toBe(true)
  })

  it('treats a missing element as at the bottom', () => {
    expect(isNearBottom(null)).toBe(true)
  })
})
