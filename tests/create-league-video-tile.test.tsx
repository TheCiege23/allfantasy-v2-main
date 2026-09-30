import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateLeagueVideoTile } from '@/components/create-league-v2/CreateLeagueVideoTile'

afterEach(() => vi.restoreAllMocks())

describe('league concept video controls', () => {
  it('plays and pauses from the explicit control without selecting the concept', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const onSelect = vi.fn()

    render(
      <CreateLeagueVideoTile
        title="Dynasty"
        selected={false}
        onSelect={onSelect}
        media={{ video: '/media/create-league/concept/videos/Dynasty.mp4' }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Play Dynasty video' }))
    expect(play).toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Pause Dynasty video' }))
    expect(pause).toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })
})
