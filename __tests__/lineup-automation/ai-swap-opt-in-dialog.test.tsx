import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * Asked once after an AF Pro / Supreme purchase (owner's rule, 2026-11-23): AI swap stays off unless the
 * subscriber turns it on. Either answer is saved, so it never asks again.
 */
import { AiSwapOptInDialog } from '@/components/monetization/AiSwapOptInDialog'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const answer = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

describe('AiSwapOptInDialog', () => {
  it('asks a subscriber who has never chosen, and saves "on"', async () => {
    fetchMock.mockImplementation((_url: string, init?: { method?: string }) =>
      init?.method === 'POST' ? answer({ ok: true }) : answer({ on: false, decided: false, entitled: true }))
    render(<AiSwapOptInDialog />)
    expect(await screen.findByText('Turn on Chimmy Auto-Swap?')).toBeTruthy()
    fireEvent.click(screen.getByText('Turn on Auto-Swap'))
    await waitFor(() => expect(screen.queryByText('Turn on Chimmy Auto-Swap?')).toBeNull())
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')
    expect(JSON.parse(post![1].body)).toEqual({ on: true })
  })

  it('saves "Not now" as off, so it does not ask again', async () => {
    fetchMock.mockImplementation((_url: string, init?: { method?: string }) =>
      init?.method === 'POST' ? answer({ ok: true }) : answer({ on: false, decided: false, entitled: true }))
    render(<AiSwapOptInDialog />)
    fireEvent.click(await screen.findByText('Not now'))
    await waitFor(() => expect(screen.queryByText('Turn on Chimmy Auto-Swap?')).toBeNull())
    expect(JSON.parse(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')![1].body)).toEqual({ on: false })
  })

  it('shows nothing to someone who already chose', async () => {
    fetchMock.mockImplementation(() => answer({ on: false, decided: true, entitled: true }))
    render(<AiSwapOptInDialog />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByText('Turn on Chimmy Auto-Swap?')).toBeNull()
  })
})
