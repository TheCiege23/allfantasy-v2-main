import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { gifProviderForUrl } from '@/lib/rich-message/GIFIntegrationResolver'

/*
 * The GIF picker credited GIPHY under every GIF, while the preloaded grid is Klipy's (all 100 rows
 * were static.klipy.com on 2026-09-25). Klipy's terms want "Search KLIPY" in the box and its credit
 * under its GIFs; GIPHY's want theirs. The credit now follows where the GIFs on screen came from.
 */

describe('gifProviderForUrl', () => {
  it('names the service by host, and nothing it does not know', () => {
    expect(gifProviderForUrl('https://static.klipy.com/ii/abc/x.gif')).toBe('klipy')
    expect(gifProviderForUrl('https://media4.giphy.com/media/x/giphy.gif')).toBe('giphy')
    expect(gifProviderForUrl('https://media.tenor.com/x.gif')).toBe('tenor')
    expect(gifProviderForUrl('https://storage.googleapis.com/x.gif')).toBeNull()
    expect(gifProviderForUrl('https://notklipy.com/x.gif')).toBeNull()
    expect(gifProviderForUrl('https://klipy.com.evil.test/x.gif')).toBeNull()
    expect(gifProviderForUrl('not a url')).toBeNull()
    expect(gifProviderForUrl(null)).toBeNull()
  })
})

async function renderPicker(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => body })))
  const { GifPicker } = await import('@/app/dashboard/components/chat/GifPicker')
  render(<GifPicker onSelect={vi.fn()} onClose={vi.fn()} />)
}

const gif = { id: 'g1', giphyId: 'k1', url: 'https://static.klipy.com/a.gif', previewUrl: 'https://static.klipy.com/a.gif', title: 'td' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GifPicker attribution', () => {
  it('credits Klipy, and says "Search KLIPY", when Klipy supplied the GIFs', async () => {
    await renderPicker({ gifs: [gif], provider: 'klipy', searchProvider: 'klipy' })
    await waitFor(() => expect(screen.getByText('Powered by KLIPY')).toBeTruthy())
    expect(screen.getByTestId('gif-picker-search').getAttribute('placeholder')).toBe('Search KLIPY')
    expect(screen.queryByText(/GIPHY/)).toBeNull()
    expect(screen.queryByAltText(/GIPHY/)).toBeNull()
  })

  it('credits GIPHY when GIPHY supplied them', async () => {
    await renderPicker({ gifs: [{ ...gif, url: 'https://media.giphy.com/a.gif' }], provider: 'giphy', searchProvider: 'giphy' })
    await waitFor(() => expect(screen.getByAltText('Powered By GIPHY')).toBeTruthy())
    expect(screen.queryByText('Powered by KLIPY')).toBeNull()
    expect(screen.getByTestId('gif-picker-search').getAttribute('placeholder')).toBe('Search GIFs...')
  })

  it('credits no one it cannot name', async () => {
    await renderPicker({ gifs: [], provider: null, searchProvider: null })
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(screen.queryByText(/KLIPY|GIPHY/)).toBeNull()
    expect(screen.queryByAltText(/GIPHY/)).toBeNull()
  })
})
