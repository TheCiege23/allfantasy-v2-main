import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'

/*
 * E2 (hands-on chat test, 2026-09-25): a FAILED history read looked exactly like an EMPTY one.
 *
 * `GET /api/chat/chimmy` answered a database error with `200 { turns: [] }`, and the drawer's hook
 * swallowed any non-ok answer. Both paths ended at "Nothing asked yet." — telling someone with a
 * real transcript that they had never asked Chimmy anything. A failed read now says so, with a
 * Retry; a genuinely empty history still gets the welcome.
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'
import { useScopedConversation } from '@/components/core-app/comms/useScopedConversation'

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> }
const reply = (status: number, body: unknown): Reply => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function isHistoryRead(url: unknown, init?: { method?: string }) {
  return String(url).startsWith('/api/chat/chimmy?') && (!init?.method || init.method === 'GET')
}

beforeEach(() => {
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

describe('useScopedConversation — a failed history read is not an empty history', () => {
  it('reports the failure, and a retry that succeeds clears it and fills the thread', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(500, { error: 'x' }))
      .mockResolvedValueOnce(reply(200, { turns: [{ id: 'hist-0', role: 'you', text: 'who do I start?' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useScopedConversation('user-a', 'global'))
    await waitFor(() => expect(result.current.historyFailed).toBe(true))
    expect(result.current.turns).toEqual([])

    await act(async () => { result.current.retryHistory() })
    await waitFor(() => expect(result.current.turns).toHaveLength(1))
    expect(result.current.historyFailed).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a thrown fetch (offline) as a failure too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const { result } = renderHook(() => useScopedConversation('user-a', 'global'))
    await waitFor(() => expect(result.current.historyFailed).toBe(true))
  })

  it('a genuinely empty history is not a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { turns: [] })))
    const { result } = renderHook(() => useScopedConversation('user-a', 'global'))
    await act(async () => {})
    await waitFor(() => expect(result.current.turns).toEqual([]))
    expect(result.current.historyFailed).toBe(false)
  })
})

describe('Chimmy tab — the error replaces the welcome, never the other way round', () => {
  function openChimmy() {
    render(
      <CommsDrawer
        open
        onClose={vi.fn()}
        mode="overlay"
        leagues={[] as never}
        pageLeagueId={null}
        chimmyTokenCost={9}
        initialTab="chimmy"
        userId="u1"
      />,
    )
  }

  it('shows a plain error with Try again when the history read fails, not "Nothing asked yet."', async () => {
    let historyFails = true
    const fetchMock = vi.fn(async (url: unknown, init?: { method?: string }) => {
      if (isHistoryRead(url, init)) {
        return historyFails
          ? reply(500, { error: 'Could not load' })
          : reply(200, { turns: [{ id: 'hist-0', role: 'chimmy', text: 'Start the Bills defense.' }] })
      }
      return reply(200, {})
    })
    vi.stubGlobal('fetch', fetchMock)
    openChimmy()

    expect(await screen.findByText("Couldn't load your Chimmy history.")).toBeTruthy()
    expect(screen.queryByText('Nothing asked yet.')).toBeNull()

    historyFails = false
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Start the Bills defense.')).toBeTruthy()
    expect(screen.queryByText("Couldn't load your Chimmy history.")).toBeNull()
  })

  it('still welcomes someone whose history is genuinely empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { turns: [] })))
    openChimmy()
    expect(await screen.findByText('Nothing asked yet.')).toBeTruthy()
    await act(async () => {})
    expect(screen.queryByText("Couldn't load your Chimmy history.")).toBeNull()
  })
})
