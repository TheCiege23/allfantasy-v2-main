import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLeagueSectionData } from '@/hooks/useLeagueSectionData'

/**
 * Coming back to the window refetches the tab. That refetch used to flip `loading`, and every
 * tab renders its skeleton on `loading` — so the first click after returning blanked the tab and
 * redrew it, which read as the page reloading. A background refetch must swap values in place.
 */

function deferredFetch() {
  const pending: Array<(body: unknown, status?: number) => void> = []
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        pending.push((body, status = 200) => resolve(new Response(JSON.stringify(body), { status })))
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, respond: (body: unknown, status?: number) => pending.shift()!(body, status) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useLeagueSectionData', () => {
  it('a focus refetch keeps the current data on screen and never re-enters loading', async () => {
    const { respond, fetchMock } = deferredFetch()
    const { result } = renderHook(() => useLeagueSectionData<{ v: number }>('L1', 'standings'))
    expect(result.current.loading).toBe(true)
    await act(async () => respond({ v: 1 }))
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))
    expect(result.current.loading).toBe(false)

    act(() => void window.dispatchEvent(new Event('focus')))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Mid-refetch: still showing the old values, flagged as refreshing, not loading.
    expect(result.current.loading).toBe(false)
    expect(result.current.refreshing).toBe(true)
    expect(result.current.data).toEqual({ v: 1 })

    await act(async () => respond({ v: 2 }))
    await waitFor(() => expect(result.current.data).toEqual({ v: 2 }))
    expect(result.current.refreshing).toBe(false)
  })

  it('a failed background refetch keeps the data instead of replacing it with an error', async () => {
    const { respond } = deferredFetch()
    const { result } = renderHook(() => useLeagueSectionData<{ v: number }>('L1', 'roster'))
    await act(async () => respond({ v: 1 }))
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))

    await act(async () => {
      void result.current.reload()
    })
    await act(async () => respond({ error: 'boom' }, 500))
    await waitFor(() => expect(result.current.refreshing).toBe(false))
    expect(result.current.data).toEqual({ v: 1 })
    expect(result.current.error).toBeNull()
  })

  it('switching to another league DOES show loading — that data is not on screen yet', async () => {
    const { respond } = deferredFetch()
    const { result, rerender } = renderHook(({ id }) => useLeagueSectionData<{ v: number }>(id, 'roster'), {
      initialProps: { id: 'L1' },
    })
    await act(async () => respond({ v: 1 }))
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))

    rerender({ id: 'L2' })
    await waitFor(() => expect(result.current.loading).toBe(true))
    expect(result.current.data).toBeNull()
    await act(async () => respond({ v: 9 }))
    await waitFor(() => expect(result.current.data).toEqual({ v: 9 }))
  })
})
