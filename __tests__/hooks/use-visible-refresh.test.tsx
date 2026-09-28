// @vitest-environment jsdom
/**
 * `useVisibleRefresh` — how a trade screen notices an offer sent while it is open (2026-09-25).
 * Before it, the inbox read once and sat there until the manager navigated away and back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useVisibleRefresh } from '@/hooks/useVisibleRefresh'

function Probe(props: { refresh: () => unknown; intervalMs?: number | null; enabled?: boolean }) {
  useVisibleRefresh(props.refresh, { intervalMs: props.intervalMs, enabled: props.enabled })
  return null
}

let visibility: 'visible' | 'hidden' = 'visible'
const T0 = new Date('2026-09-25T15:00:00Z').getTime()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useVisibleRefresh', () => {
  it('🛑 refreshes on the interval while the page is in view', async () => {
    const refresh = vi.fn()
    render(<Probe refresh={refresh} intervalMs={60_000} />)
    expect(refresh).not.toHaveBeenCalled() // the mount load is the component's own
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    await flush()
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    await flush()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('does not poll a hidden tab — and refreshes once when it comes back', async () => {
    const refresh = vi.fn()
    render(<Probe refresh={refresh} intervalMs={60_000} />)
    visibility = 'hidden'
    await act(async () => {
      vi.advanceTimersByTime(180_000)
    })
    await flush()
    expect(refresh).not.toHaveBeenCalled()

    visibility = 'visible'
    await act(async () => {
      // Returning fires BOTH events; that must be ONE read, not two.
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not repeat the mount load when focus arrives straight after it', async () => {
    const refresh = vi.fn()
    render(<Probe refresh={refresh} intervalMs={null} />)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('never stacks a refresh on one still in flight', async () => {
    let release: () => void = () => {}
    const refresh = vi.fn(() => new Promise<void>((r) => { release = r }))
    render(<Probe refresh={refresh} intervalMs={10_000} />)
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })
      await flush()
    }
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => {
      release()
    })
    await flush()
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    await flush()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('a refresh that throws does not stop the next one', async () => {
    const refresh = vi.fn(async () => {
      throw new Error('blip')
    })
    render(<Probe refresh={refresh} intervalMs={10_000} />)
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    await flush()
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    await flush()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('stops everything on unmount, and does nothing when disabled', async () => {
    const refresh = vi.fn()
    const { unmount } = render(<Probe refresh={refresh} intervalMs={10_000} />)
    unmount()
    await act(async () => {
      vi.advanceTimersByTime(60_000)
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(refresh).not.toHaveBeenCalled()

    render(<Probe refresh={refresh} intervalMs={10_000} enabled={false} />)
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    await flush()
    expect(refresh).not.toHaveBeenCalled()
  })
})
