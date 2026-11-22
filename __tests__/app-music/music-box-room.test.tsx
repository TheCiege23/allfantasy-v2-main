/**
 * The page makes room for the corner music box (af-app-music.css, `data-af-music-box`).
 * The engine marks <html> only while the YouTube box sits in the corner: not in the
 * chat's Music tab, not in a page's own slot, and not once the music stops.
 */
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated' }) }))
vi.mock('next/navigation', () => ({ usePathname: () => '/core' }))
vi.mock('@/lib/apple-music/musicKitClient', () => ({
  artworkUrl: () => '',
  searchCatalog: vi.fn(),
  setUpMusicKit: vi.fn(() => new Promise(() => {})),
}))

import { AppMusicDock } from '@/components/app-music/AppMusicDock'
import { musicBus } from '@/components/app-music/musicBus'

const marked = () => document.documentElement.hasAttribute('data-af-music-box')
const RECT = { left: 10, top: 10, width: 320, height: 240 }

function play() {
  act(() =>
    musicBus.actions()!.playYouTube({ key: 'hype', label: 'Game day hype', source: { kind: 'playlist', listId: 'PL1' } }),
  )
}

afterEach(() => {
  act(() => {
    musicBus.setScreen(null)
    musicBus.setSlot(null)
  })
  cleanup()
})

describe('corner music box makes the page give way', () => {
  it('marks the page only while the box is in the corner', () => {
    render(<AppMusicDock />)
    expect(marked()).toBe(false)

    play()
    expect(marked()).toBe(true)

    act(() => musicBus.setScreen(RECT)) // chat's Music tab open: the player is in the chat
    expect(marked()).toBe(false)

    act(() => musicBus.setScreen(null))
    expect(marked()).toBe(true)

    act(() => musicBus.setSlot(RECT)) // a page's own slot (the draft room)
    expect(marked()).toBe(false)
  })

  it('clears the mark when the music stops or the engine goes away', () => {
    const { unmount } = render(<AppMusicDock />)
    play()
    expect(marked()).toBe(true)
    act(() => musicBus.actions()!.stop())
    expect(marked()).toBe(false)

    play()
    expect(marked()).toBe(true)
    unmount()
    expect(marked()).toBe(false)
  })
})
