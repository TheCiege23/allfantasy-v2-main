import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * The chat emoji picker: every tab is a named emoji (not the "•" it used to print), the fantasy tab
 * comes first, search reaches the whole set, and a tap always inserts — even where storage is blocked.
 */

const CATALOG = {
  emojis: [
    { id: '1F600', char: '😀', name: 'grinning face', shortcode: 'grinning', category: 'smileys', keywords: 'grinning face' },
    { id: '1F410', char: '🐐', name: 'goat', shortcode: 'goat', category: 'nature', keywords: 'goat' },
    { id: '1F525', char: '🔥', name: 'fire', shortcode: 'fire', category: 'travel', keywords: 'fire lit' },
    { id: '1F3C8', char: '🏈', name: 'american football', shortcode: 'football', category: 'activities', keywords: 'american football' },
  ],
  categories: [
    { key: 'fantasy', label: 'Fantasy', icon: '🏈' },
    { key: 'smileys', label: 'Smileys', icon: '😀' },
    { key: 'nature', label: 'Animals & nature', icon: '🐐' },
    { key: 'travel', label: 'Travel & places', icon: '✈️' },
    { key: 'activities', label: 'Sports & activities', icon: '🏆' },
    { key: 'flags', label: 'Flags', icon: '🏁' },
  ],
  fantasy: ['1F3C8', '1F525', '1F410'],
}

async function load(response: unknown, ok = true) {
  vi.resetModules()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => response })))
  const { EmojiPicker } = await import('@/app/dashboard/components/chat/EmojiPicker')
  const onSelect = vi.fn()
  render(<EmojiPicker onSelect={onSelect} onClose={vi.fn()} />)
  return onSelect
}

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('EmojiPicker', () => {
  it('opens on the fantasy tab, with every tab named — and no tab for an empty category', async () => {
    await load(CATALOG)
    await waitFor(() => expect(screen.getByRole('button', { name: 'american football' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Fantasy' }).getAttribute('aria-pressed')).toBe('true')
    const order = ['american football', 'fire', 'goat']
    const grid = screen.getAllByRole('button').filter((b) => order.includes(b.getAttribute('aria-label') ?? ''))
    expect(grid.map((b) => b.getAttribute('aria-label'))).toEqual(order)
    expect(screen.queryByRole('button', { name: 'Flags' })).toBeNull()
    expect(screen.queryByText('•')).toBeNull()
  })

  it('switches tabs', async () => {
    await load(CATALOG)
    await waitFor(() => screen.getByRole('button', { name: 'Smileys' }))
    fireEvent.click(screen.getByRole('button', { name: 'Smileys' }))
    expect(screen.getByRole('button', { name: 'grinning face' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'goat' })).toBeNull()
  })

  it('searches the whole set, by name or keyword, and says so when nothing matches', async () => {
    await load(CATALOG)
    await waitFor(() => screen.getByRole('button', { name: 'Fantasy' }))
    const box = screen.getByPlaceholderText('Search emojis...')
    fireEvent.change(box, { target: { value: 'lit' } })
    expect(screen.getByRole('button', { name: 'fire' })).toBeTruthy()
    fireEvent.change(box, { target: { value: 'grin' } })
    expect(screen.getByRole('button', { name: 'grinning face' })).toBeTruthy()
    fireEvent.change(box, { target: { value: 'zzz' } })
    expect(screen.getByText(/No emoji for/)).toBeTruthy()
  })

  it('🛑 inserts on tap even when storage is blocked', async () => {
    const onSelect = await load(CATALOG)
    await waitFor(() => screen.getByRole('button', { name: 'goat' }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    fireEvent.click(screen.getByRole('button', { name: 'goat' }))
    expect(onSelect).toHaveBeenCalledWith('🐐')
  })

  it('says it failed rather than showing an empty box', async () => {
    await load({ error: 'nope' }, false)
    await waitFor(() => expect(screen.getByText(/Emoji did not load/)).toBeTruthy())
  })
})
