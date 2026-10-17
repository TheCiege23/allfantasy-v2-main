import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PlayerHighlights from '@/components/core-app/player-card/PlayerHighlights'

const player = { sport: 'NFL', externalId: 'ri:123', source: 'rolling_insights', sleeperId: '123', name: 'Josh Allen',
  position: 'QB', team: 'BUF', number: 17, imageUrl: null }
const result = { status: 'ready', checkedAt: '2026-10-11T12:00:00Z', message: null, videos: [{
  videoId: 'abcdefghijk', title: 'Josh Allen highlights', channelTitle: 'NFL', channelId: 'official',
  publishedAt: '2026-10-11T12:00:00Z', thumbnailUrl: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg', kind: 'player',
}] }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('player highlights section', () => {
  it('waits for discovery and playback clicks, preserving the original title and source', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => result })
    vi.stubGlobal('fetch', fetcher)
    const { container } = render(<PlayerHighlights player={player} />)
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Find highlights' }))
    await screen.findByRole('link', { name: 'Watch on YouTube: Josh Allen highlights' })
    expect(fetcher.mock.calls[0][0]).toContain('externalId=ri%3A123')
    // The id is only unique per feed; the route refuses an ambiguous one without its source.
    expect(fetcher.mock.calls[0][0]).toContain('source=rolling_insights')
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.getByRole('link', { name: 'Josh Allen highlights' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcdefghijk')
    const watch = screen.getByRole('link', { name: 'Watch on YouTube: Josh Allen highlights' })
    expect(watch).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcdefghijk')
    expect(watch).toHaveAttribute('target', '_blank')
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.getByRole('link', { name: 'NFL' })).toBeInTheDocument()
  })
  it('clears clips immediately when the player changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => result }))
    const { rerender } = render(<PlayerHighlights player={player} />)
    fireEvent.click(screen.getByRole('button', { name: 'Find highlights' }))
    await screen.findByText('Josh Allen highlights')
    rerender(<PlayerHighlights player={{ ...player, externalId: 'other', name: 'Jahmyr Gibbs' }} />)
    expect(screen.queryByText('Josh Allen highlights')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Find highlights' })).toBeInTheDocument()
  })
  it('shows retryable failures and unsupported sports do not request videos', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Offline'))
    vi.stubGlobal('fetch', fetcher)
    const { rerender } = render(<PlayerHighlights player={player} />)
    fireEvent.click(screen.getByRole('button', { name: 'Find highlights' }))
    await screen.findByText('Highlights could not be loaded. Please try again later.')
    expect(screen.getByRole('button', { name: 'Try highlights again' })).toBeEnabled()
    rerender(<PlayerHighlights player={{ ...player, sport: 'NBA' }} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('aborts pending discovery when another player opens', async () => {
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetcher)
    const { rerender } = render(<PlayerHighlights player={player} />)
    fireEvent.click(screen.getByRole('button', { name: 'Find highlights' }))
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal
    rerender(<PlayerHighlights player={{ ...player, externalId: 'other' }} />)
    await waitFor(() => expect(signal.aborted).toBe(true))
  })
})
