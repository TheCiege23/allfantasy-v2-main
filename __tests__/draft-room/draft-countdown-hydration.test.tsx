import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'

import { useDraftCountdownSeconds } from '@/lib/draft/useDraftCountdown'
import { snapshotDraftCountdownSeconds } from '@/lib/draft/computeDraftCountdownSeconds'

/*
 * The pick clock rendered "0:55" on the server and "0:52" in the browser's first render, because the
 * hook read Date.now() during render and the two renders run seconds apart — React then discarded
 * the whole draft-room tree ("Hydration failed because the server rendered text didn't match").
 * Until mount the hook now prints the snapshot's own remainingSeconds; after mount, the live clock.
 */

const T0 = Date.parse('2026-11-25T18:00:00.000Z')
/** The snapshot was built at T0 with 55s left on a per-pick clock. */
const END_AT = new Date(T0 + 55_000).toISOString()

function Clock() {
  const sec = useDraftCountdownSeconds('running', END_AT, 55)
  return <span data-testid="clock">{sec == null ? '-' : String(sec)}</span>
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0 + 2_000) // the server renders 2s after the snapshot was built
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('snapshotDraftCountdownSeconds', () => {
  it('uses only the snapshot, never the clock', () => {
    expect(snapshotDraftCountdownSeconds('running', 55)).toBe(55)
    expect(snapshotDraftCountdownSeconds('running', 54.2)).toBe(55)
    expect(snapshotDraftCountdownSeconds('paused', 30)).toBe(30)
    expect(snapshotDraftCountdownSeconds('expired', 12)).toBe(0)
    expect(snapshotDraftCountdownSeconds('running', null)).toBeNull()
    expect(snapshotDraftCountdownSeconds('none', undefined)).toBeNull()
  })
})

describe('useDraftCountdownSeconds hydration', () => {
  it('server-renders the snapshot value, not a clock reading', () => {
    expect(renderToString(<Clock />)).toContain('>55<')
  })

  it('hydrates without a mismatch when the browser clock has moved on, then shows the live value', async () => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(<Clock />)
    document.body.appendChild(container)
    vi.setSystemTime(T0 + 5_000) // hydration lands 3s after the server render

    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(String(args[0]))
    })
    const recoverable: string[] = []
    let root: ReturnType<typeof hydrateRoot> | undefined
    try {
      await act(async () => {
        root = hydrateRoot(container, <Clock />, { onRecoverableError: (e) => recoverable.push(String(e)) })
      })
      spy.mockRestore()

      expect(recoverable).toEqual([])
      expect(errors.filter((e) => /hydrat|did not match|mismatch/i.test(e))).toEqual([])
      // Immediately after hydration (no interval tick yet) the live clock has taken over: 55 - 5 = 50.
      expect(container.textContent).toBe('50')
    } finally {
      spy.mockRestore()
      act(() => root?.unmount())
      document.body.removeChild(container)
    }
  })

  it('keeps ticking from the wall clock after mount', () => {
    const { getByTestId } = render(<Clock />)
    expect(getByTestId('clock').textContent).toBe('53')
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(getByTestId('clock').textContent).toBe('50')
  })
})
