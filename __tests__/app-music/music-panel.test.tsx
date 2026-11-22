import React from 'react'
import { act as rtlAct, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MusicPanel } from '@/components/app-music/MusicPanel'
import { musicBus, type MusicActions, type MusicSnapshot } from '@/components/app-music/musicBus'

/*
 * The chat panel's Music tab, driven through the real bus the engine uses.
 * No provider is mounted, so the copy is English (useOptionalLanguage's fallback).
 */

const BASE: MusicSnapshot = {
  ready: true,
  yt: null,
  appleStatus: 'signed-out',
  appleNow: null,
  appleMsg: null,
  results: [],
  searching: false,
}

const NO_SUB_KEY = 'af:apple-music:no-subscription'

function actions(): MusicActions {
  return {
    playYouTube: vi.fn(),
    stop: vi.fn(),
    startApple: vi.fn(),
    connectApple: vi.fn(),
    disconnectApple: vi.fn(),
    search: vi.fn(),
    playApple: vi.fn(),
    appleToggle: vi.fn(),
    appleNext: vi.fn(),
    applePrev: vi.fn(),
  }
}

function publish(patch: Partial<MusicSnapshot>) {
  rtlAct(() => musicBus.publish({ ...BASE, ...patch }))
}

function openApple() {
  fireEvent.click(screen.getByRole('tab', { name: 'Apple Music' }))
}

beforeEach(() => {
  window.localStorage.clear()
  musicBus.setActions(actions())
  musicBus.publish(BASE)
})

afterEach(() => {
  cleanup()
  musicBus.setActions(null)
  vi.unstubAllGlobals()
})

describe('YouTube search header', () => {
  it('names the query above real results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        json: async () => ({
          status: 'ok',
          results: [{ videoId: 'abc', title: 'Song', channel: 'Artist', thumb: null }],
        }),
      })),
    )
    render(<MusicPanel />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search YouTube' }), { target: { value: 'lofi' } })
    fireEvent.submit(screen.getByRole('searchbox', { name: 'Search YouTube' }).closest('form')!)
    expect(await screen.findByText('Song')).toBeTruthy()
    expect(screen.getByText(/Results for/)).toBeTruthy()
  })

  it('shows a limit note on its own, with no "Results for" above it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 200, json: async () => ({ status: 'limit', scope: 'user' }) })),
    )
    render(<MusicPanel />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search YouTube' }), { target: { value: 'lofi beats' } })
    fireEvent.submit(screen.getByRole('searchbox', { name: 'Search YouTube' }).closest('form')!)
    expect(await screen.findByText(/You’ve used today’s YouTube searches/)).toBeTruthy()
    expect(screen.queryByText(/Results for/)).toBeNull()
    // Clear still works from the note.
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByText(/You’ve used today’s YouTube searches/)).toBeNull()
  })
})

describe('Apple Music without a subscription', () => {
  it('offers search and Connect when nothing has failed', () => {
    render(<MusicPanel />)
    openApple()
    expect(screen.getByRole('searchbox', { name: 'Search Apple Music' })).toBeTruthy()
    expect(screen.queryByTestId('apple-no-subscription')).toBeNull()
  })

  it('remembers a failed connect: one line and a retry instead of a search that cannot play', () => {
    render(<MusicPanel />)
    openApple()
    publish({ appleMsg: { code: 'connect-failed' } })
    expect(window.localStorage.getItem(NO_SUB_KEY)).toBe('1')
    expect(screen.getByTestId('apple-no-subscription').textContent).toMatch(/needs a subscription/)
    expect(screen.queryByRole('searchbox', { name: 'Search Apple Music' })).toBeNull()
    // The long connect-failed message is not shown twice.
    expect(screen.queryByText(/didn’t connect\. If Apple showed you/)).toBeNull()
  })

  it('opens on YouTube next time even if Apple was the last side used', () => {
    window.localStorage.setItem('af:draft-music:source', 'apple')
    window.localStorage.setItem(NO_SUB_KEY, '1')
    render(<MusicPanel />)
    expect(screen.getByRole('tab', { name: 'YouTube' }).getAttribute('aria-selected')).toBe('true')
  })

  it('"Try Apple Music again" brings the search and Connect back', () => {
    window.localStorage.setItem(NO_SUB_KEY, '1')
    render(<MusicPanel />)
    openApple()
    fireEvent.click(screen.getByRole('button', { name: 'Try Apple Music again' }))
    expect(window.localStorage.getItem(NO_SUB_KEY)).toBeNull()
    expect(screen.getByRole('searchbox', { name: 'Search Apple Music' })).toBeTruthy()
  })

  it('forgets it once Apple Music connects', () => {
    window.localStorage.setItem(NO_SUB_KEY, '1')
    render(<MusicPanel />)
    publish({ appleStatus: 'ready' })
    expect(window.localStorage.getItem(NO_SUB_KEY)).toBeNull()
  })
})
