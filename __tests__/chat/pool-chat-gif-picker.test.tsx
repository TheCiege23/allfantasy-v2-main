import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/hooks/useUserTimezone', () => ({ useUserTimezone: () => ({ timezone: 'UTC' }) }))

import { GifPicker } from '@/components/bracket/PoolChat'

/*
 * The bracket pool chat's GIF picker called Tenor from the browser — an API Google shut down on
 * 2026-06-30 — so it showed nothing. It now reads our /api/chat/gifs and credits whoever answered.
 */

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const GRID = {
  provider: 'klipy',
  searchProvider: 'klipy',
  gifs: [{ id: 'g1', url: 'https://static.klipy.com/td.gif', previewUrl: 'https://static.klipy.com/td-s.gif', title: 'touchdown' }],
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('pool chat GIF picker', () => {
  it('opens on the preloaded grid from our server, says "Search KLIPY", and credits Klipy', async () => {
    const f = vi.fn(async () => json(GRID))
    vi.stubGlobal('fetch', f)
    const onSelect = vi.fn()
    render(<GifPicker onSelect={onSelect} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send GIF: touchdown' })).toBeTruthy())
    expect(String(f.mock.calls[0]![0])).toBe('/api/chat/gifs?limit=24')
    for (const call of f.mock.calls) expect(String(call[0])).not.toMatch(/tenor|giphy\.com|klipy\.com/)
    expect(screen.getByLabelText('Search GIFs').getAttribute('placeholder')).toBe('Search KLIPY')
    expect(screen.getByText('Powered by KLIPY').closest('a')?.getAttribute('href')).toBe('https://klipy.com')
    expect(screen.queryByText(/Tenor/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Send GIF: touchdown' }))
    expect(onSelect).toHaveBeenCalledWith('https://static.klipy.com/td.gif')
  })

  it('searches after a pause, through the same route', async () => {
    const f = vi.fn(async (url: unknown) =>
      String(url).includes('q=')
        ? json({ ...GRID, gifs: [{ id: 's1', url: 'https://static.klipy.com/win.gif', title: 'win' }] })
        : json(GRID),
    )
    vi.stubGlobal('fetch', f)
    render(<GifPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => screen.getByRole('button', { name: 'Send GIF: touchdown' }))
    fireEvent.change(screen.getByLabelText('Search GIFs'), { target: { value: 'win' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send GIF: win' })).toBeTruthy(), { timeout: 2000 })
    expect(f.mock.calls.map((c) => String(c[0]))).toContain('/api/chat/gifs?limit=24&q=win')
  })

  it('says so when there is nothing, rather than an empty box', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ gifs: [], provider: null, searchProvider: null })))
    render(<GifPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/GIFs aren't available right now/)).toBeTruthy())
    expect(screen.queryByText(/Powered by/)).toBeNull()
  })
})
