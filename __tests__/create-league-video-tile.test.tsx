import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateLeagueVideoTile } from '@/components/create-league-v2/CreateLeagueVideoTile'

function mockReducedMotion(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

describe('CreateLeagueVideoTile', () => {
  let play: ReturnType<typeof vi.fn>
  let pause: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockReducedMotion(false)
    play = vi.fn().mockResolvedValue(undefined)
    pause = vi.fn()
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: play,
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: pause,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('plays muted inline video on hover and pauses on leave', async () => {
    render(
      <CreateLeagueVideoTile
        title="NFL"
        hint="Fast setup"
        selected={false}
        onSelect={vi.fn()}
        media={{ video: '/media/create-league/sports/videos/Football.mp4', poster: '/Football.png' }}
        testId="tile"
      />,
    )

    const tile = screen.getByTestId('tile')
    const video = screen.getByTestId('tile-video') as HTMLVideoElement

    expect(video.muted).toBe(true)
    expect(video.playsInline).toBe(true)

    fireEvent.mouseEnter(tile)
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1))
    expect(tile).toHaveAttribute('data-video-preview', 'playing')

    fireEvent.mouseLeave(tile)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(tile).toHaveAttribute('data-video-preview', 'paused')
  })

  it('keeps selection clickable after preview starts', async () => {
    const onSelect = vi.fn()
    render(
      <CreateLeagueVideoTile
        title="NBA"
        selected={false}
        onSelect={onSelect}
        media={{ video: '/media/create-league/sports/videos/Basketball.mp4' }}
        testId="tile"
      />,
    )

    const tile = screen.getByTestId('tile')
    fireEvent.focus(tile)
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1))
    fireEvent.click(tile)

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('does not autoplay when reduced motion is requested', async () => {
    mockReducedMotion(true)
    render(
      <CreateLeagueVideoTile
        title="NFL"
        selected={false}
        onSelect={vi.fn()}
        media={{ video: '/media/create-league/sports/videos/Football.mp4' }}
        testId="tile"
      />,
    )

    const tile = screen.getByTestId('tile')
    fireEvent.mouseEnter(tile)

    expect(play).not.toHaveBeenCalled()
    expect(tile).toHaveAttribute('data-video-disabled', 'true')
    expect(tile).toHaveAttribute('data-video-preview', 'paused')
  })

  it('does not play unavailable or locked video tiles', () => {
    render(
      <CreateLeagueVideoTile
        title="Coming soon"
        selected={false}
        locked
        onSelect={vi.fn()}
        media={{ video: '/missing.mp4' }}
        testId="tile"
      />,
    )

    const tile = screen.getByTestId('tile')
    fireEvent.pointerDown(tile, { pointerType: 'touch' })
    fireEvent.mouseEnter(tile)

    expect(play).not.toHaveBeenCalled()
    expect(tile).toHaveAttribute('data-video-disabled', 'true')
  })
})
