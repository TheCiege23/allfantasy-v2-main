import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import ChimmyMusicCard from '@/components/chimmy/ChimmyMusicCard'
import { musicBus, type MusicActions } from '@/components/app-music/musicBus'

/* The music card in the browser (2026-11-16): nothing plays until the tap; the tap calls the engine. */

const actions = (): MusicActions => ({
  playYouTube: vi.fn(),
  stop: vi.fn(),
  startApple: vi.fn(),
  connectApple: vi.fn(),
  disconnectApple: vi.fn(),
  search: vi.fn(),
  playApple: vi.fn(),
  appleToggle: vi.fn(),
} as unknown as MusicActions)

let a: MusicActions
beforeEach(() => {
  a = actions()
  act(() => {
    musicBus.setActions(a)
    musicBus.publish({ ...musicBus.getSnapshot(), ready: true })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  act(() => {
    musicBus.setActions(null)
    musicBus.publish({ ...musicBus.getSnapshot(), ready: false })
  })
})

describe('ChimmyMusicCard', () => {
  it('🛑 a station plays only on the tap, through the music engine', () => {
    render(<ChimmyMusicCard card={{ kind: 'station', stationId: 'game-day', label: 'Game day hype' }} />)
    expect(a.playYouTube).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('chimmy-music-play'))
    expect(a.playYouTube).toHaveBeenCalledWith(expect.objectContaining({ key: 'game-day', label: 'Game day hype', source: expect.objectContaining({ kind: 'playlist' }) }))
    expect(screen.getByTestId('chimmy-music-note').textContent).toBe('Playing in the music player.')
  })

  it("a search plays YouTube's top result for it", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok', results: [{ videoId: 'abcdefghijk', title: 'Drake – Started From the Bottom', channel: 'Drake', thumb: null }] }), { status: 200 })))
    render(<ChimmyMusicCard card={{ kind: 'search', term: 'Drake' }} />)
    fireEvent.click(screen.getByTestId('chimmy-music-play'))
    await waitFor(() => expect(a.playYouTube).toHaveBeenCalledWith({ key: 'search:abcdefghijk', label: 'Drake – Started From the Bottom', source: { kind: 'video', videoId: 'abcdefghijk' } }))
  })

  it('a search over the daily limit says so and plays nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'limit', scope: 'user' }), { status: 200 })))
    render(<ChimmyMusicCard card={{ kind: 'search', term: 'Drake' }} />)
    fireEvent.click(screen.getByTestId('chimmy-music-play'))
    await waitFor(() => expect(screen.getByTestId('chimmy-music-note').textContent).toMatch(/today's music searches/))
    expect(a.playYouTube).not.toHaveBeenCalled()
  })

  it('stop stops', () => {
    render(<ChimmyMusicCard card={{ kind: 'stop' }} />)
    fireEvent.click(screen.getByTestId('chimmy-music-play'))
    expect(a.stop).toHaveBeenCalledTimes(1)
  })

  it('where the music engine is not running, the card says so and the button is off', () => {
    act(() => {
      musicBus.setActions(null)
      musicBus.publish({ ...musicBus.getSnapshot(), ready: false })
    })
    render(<ChimmyMusicCard card={{ kind: 'station', stationId: 'rock', label: 'Rock hits' }} />)
    expect(screen.getByTestId('chimmy-music-note').textContent).toBe('Music is not available on this page.')
    expect((screen.getByTestId('chimmy-music-play') as HTMLButtonElement).disabled).toBe(true)
  })
})
